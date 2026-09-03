"""Generate the knowledge-graph lineage seed (docs/AI_ASSISTANT_PLAN.md §8, Increment 1.5).

The lineage is not new information: it is in migration headers, `dim_dataset`, `ingestion/`, and
the `docs/` write-ups. It is simply not queryable. This script reads those files and emits the
`kb_node` / `kb_edge` rows that make it queryable — no model, no extraction, no inference beyond
what the repository literally says.

That is the point of doing it as a script rather than by hand. Every edge is reproducible from the
files by re-running this, so an edge can be *checked* by anyone who opens the migration it names —
which is what makes these edges the reference example that later extracted edges (Phase 3) are
measured against. Re-run it after adding a migration or an ingestion script, over a temporary file:

    python ingestion/build_kb_lineage.py > /tmp/lineage.sql \
      && mv /tmp/lineage.sql supabase/migrations/20260826120100_seed_kb_lineage.sql

Redirecting straight onto the seed truncates it *before* the generator runs, and the seed is
itself a migration this script reads — so the shell would silently delete a node from the output.
Regenerate in place rather than emitting a second dated seed: the file is wholly generated and its
inserts are upserts, and two files both claiming to be the current lineage is exactly the drift a
generated file is supposed to remove.

What it reads, and what each read asserts:

* `supabase/migrations/*.sql` — `create table` / `create view` / `alter table` give `built-by`
  edges; a view's own defining query gives `derived-from`; a `docs/*.md` path in a migration
  gives `reconciled-in`; `insert into dim_dataset` gives the dataset nodes.
* `supabase/migrations/*_seed_dataset_registry.sql` — the 1.2 registry: `dataset_slug` gives
  `derived-from` (table → source dataset), `doc_path` gives `reconciled-in`, and `joins_to` gives
  `joins-on` between column nodes, so the registry and the graph are one structure rather than two.
* `ingestion/*.py`, `ingestion/*.sql` — a write to a table gives `built-by` (table → script); a
  read inside the same statement gives `derived-from` (table → source table), resolved one level
  through the `_`-prefixed working tables so `agg_bhw_counts` reaches `fact_bhw_raw` rather than
  stopping at `_agg_base`.

* any file — a `-- lineage: <src-key> <relation> <dst-key>` directive states an edge outright.
  Reserved for provenance that is true but structurally invisible: `fact_uuc_phc_indicators`
  is derived from the cleaning report's bounding process, and no `from` or `join` says so.

Everything it cannot establish from a file, it leaves out. A table with no `built-by` edge is a
finding, not a gap to fill by guessing; it is printed to stderr. `fact_uuc_phc_barangay` was that
case until its migration was committed (plan U5), and the finding is what surfaced it.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MIGRATIONS = REPO / "supabase" / "migrations"
INGESTION = REPO / "ingestion"
EXTRACTIONS = INGESTION / "data"

CREATE_TABLE_RE = re.compile(r"create\s+table\s+(?:if\s+not\s+exists\s+)?(\w+)", re.I)
ALTER_TABLE_RE = re.compile(r"alter\s+table\s+(?:only\s+)?(\w+)", re.I)
# Views are relations this graph has to carry: `ref_uuc_phc_provincial` is registered in the
# dataset registry and queried like any other table, so a graph that only knew `create table`
# would report it as a table nobody built. They are keyed `table:` rather than a new node kind —
# the registry, `queryDataset` and every read path treat a view as a table, and inventing a
# second kind here would split one concept across two vocabularies for no gain.
CREATE_VIEW_RE = re.compile(
    r"create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?(\w+)", re.I
)
# An explicit assertion, for provenance that is true but not inferable from SQL structure.
#
#     -- lineage: table:fact_uuc_phc_indicators derived-from doc:docs/UUC_PHC_2025_CLEANING_REPORT.md
#
# The cleaning report is the transformation record for that table's values — 1,584 of them were
# bounded by the process it documents — and no `from` or `join` anywhere says so. The alternative
# considered was a rule reading every `docs/*.md` path an ingestion script mentions as a
# derivation, which would have asserted `agg_population derived-from docs/DECISIONS.md`: an edge
# nobody could check by opening the file, which is the one thing this generator exists not to
# produce. A directive names both endpoints itself, so it is still checkable by opening the file
# that carries it, and it cannot be emitted by accident.
LINEAGE_DIRECTIVE_RE = re.compile(r"^\s*--\s*lineage:\s*(\S+)\s+(\S+)\s+(\S+)\s*$", re.M)
# Mirrors the check constraint on kb_edge.relation.
RELATIONS = {"derived-from", "built-by", "reconciled-in", "joins-on", "has-column", "defined-by"}

# An issuance code as this repository's own SQL writes it: "DOH AO No. 2020-0023",
# "DC No. 2025-0549", "AO 2020-0023 §VI.B". Canonicalised to `AO 2020-0023` — the same form
# `ingestion/extract_kb.py` requires of the model, because the two have to name the same node.
ISSUANCE_IN_SQL_RE = re.compile(
    r"\b(?:DOH\s+)?(AO|DC|DM|JMC|JAO)\b[\s.]*(?:No\.?)?\s*(\d{4}-\d{2,4})\b", re.I
)
COMMENT_ON_TABLE_RE = re.compile(
    r"comment\s+on\s+table\s+(\w+)\s+is\s+'((?:[^']|'')*)'", re.I
)


def issuance_keys(text: str) -> list[str]:
    """Canonical `issuance:` keys named in one piece of SQL *statement* text.

    READ FROM STRIPPED SQL, ALWAYS, AND THE NEAR-MISS IS WORTH RECORDING. An issuance code is not
    like a `docs/*.md` path: prose produces one by accident all the time. Two migrations in this
    repository name "DC No. 2025-0549" purely as an EXAMPLE in a header comment about trigram
    search (`20260826160000_doc_corpus.sql`, `20260826160100_search_documents.sql`). A raw-text
    scan would assert `table:doc_chunk defined-by issuance:DC 2025-0549` from them — the fourth
    instance of the one failure mode this script keeps hitting, caught before it was written.
    Reading only statement text limits the scan to codes the database itself carries: a table
    comment, or a `dim_dataset` row's own source field.
    """
    return sorted({f"{kind.upper()} {number}" for kind, number in ISSUANCE_IN_SQL_RE.findall(text)})
DOC_PATH_RE = re.compile(r"docs/[A-Za-z0-9_./-]+\.md")
DATASET_INSERT_RE = re.compile(r"insert\s+into\s+dim_dataset\s*\(([^)]*)\)\s*values(.*?);", re.I | re.S)

# Writes. Each pattern is a way this repository names a table it is about to write to.
WRITE_RES = [
    re.compile(r"insert\s+into\s+(\w+)", re.I),
    re.compile(r"update\s+(\w+)\s+set\b", re.I),
    re.compile(r"delete\s+from\s+(\w+)", re.I),
    re.compile(r'TABLE\s*=\s*"(\w+)"'),
    re.compile(r'insert_statement\(\s*"(\w+)"'),
    re.compile(r'emit_sql_files\(\s*"(\w+)"'),
]
READ_RE = re.compile(r"\b(?:from|join)\s+(_?\w+)", re.I)
TEMP_TABLE_RE = re.compile(r"create\s+table\s+(_\w+)\s+as", re.I)


def sql_literal(value: str | None) -> str:
    if value is None:
        return "null"
    return "'" + value.replace("'", "''") + "'"


def strip_sql_comments(sql: str) -> str:
    """Drop `--` line comments before any statement parsing.

    Not cosmetic: this repository's migration headers are prose, and prose contains apostrophes
    ("each table's own migration"). A quote-tracking splitter that reads those as string delimiters
    desynchronizes for the rest of the file and silently produces nothing.
    """
    out, in_string = [], False
    for line in sql.splitlines():
        cleaned = []
        i = 0
        while i < len(line):
            char = line[i]
            if char == "'":
                in_string = not in_string
            if not in_string and char == "-" and line[i : i + 2] == "--":
                break
            cleaned.append(char)
            i += 1
        out.append("".join(cleaned))
    return "\n".join(out)


def split_statements(sql: str) -> list[str]:
    """Split on semicolons outside string literals — enough for this repository's own SQL."""
    sql = strip_sql_comments(sql)
    statements, current, in_string = [], [], False
    for char in sql:
        if char == "'":
            in_string = not in_string
        if char == ";" and not in_string:
            statements.append("".join(current))
            current = []
            continue
        current.append(char)
    if "".join(current).strip():
        statements.append("".join(current))
    return statements


def split_tuples(values_block: str) -> list[list[str]]:
    """Yield the top-level `(...)` tuples of a VALUES block, each split on top-level commas."""
    tuples, depth, current, in_string = [], 0, [], False
    for char in values_block:
        if char == "'":
            in_string = not in_string
        if not in_string:
            if char == "(":
                depth += 1
                if depth == 1:
                    current = []
                    continue
            elif char == ")":
                depth -= 1
                if depth == 0:
                    tuples.append("".join(current))
                    continue
        if depth >= 1:
            current.append(char)

    out = []
    for raw in tuples:
        fields, field, depth, in_string = [], [], 0, False
        for char in raw:
            if char == "'":
                in_string = not in_string
            if not in_string:
                if char in "([":
                    depth += 1
                elif char in ")]":
                    depth -= 1
                elif char == "," and depth == 0:
                    fields.append("".join(field).strip())
                    field = []
                    continue
            field.append(char)
        fields.append("".join(field).strip())
        out.append(fields)
    return out


def unquote(field: str) -> str | None:
    field = field.strip()
    if field.lower() == "null":
        return None
    if field.startswith("'") and field.endswith("'"):
        return field[1:-1].replace("''", "'")
    return field


class Graph:
    """Accumulates nodes and edges, keyed so a repeated assertion collapses into one row."""

    def __init__(self) -> None:
        self.nodes: dict[str, dict] = {}
        self.edges: dict[tuple[str, str, str], dict] = {}

    def node(self, key: str, kind: str, label: str, summary: str | None, source_kind: str, source_ref: str) -> str:
        self.nodes.setdefault(
            key,
            {"key": key, "kind": kind, "label": label, "summary": summary, "source_kind": source_kind, "source_ref": source_ref},
        )
        return key

    def edge(self, src: str, relation: str, dst: str, source_kind: str, source_ref: str, note: str | None = None) -> None:
        if src == dst:
            return
        self.edges.setdefault(
            (src, relation, dst),
            {"src": src, "relation": relation, "dst": dst, "source_kind": source_kind, "source_ref": source_ref, "note": note},
        )

    def references(self, key: str) -> bool:
        """Is this node an endpoint of any edge? Asked before dropping a node as unearned."""
        return any(key in (src, dst) for src, _, dst in self.edges)


# The key prefix carries the kind — the emitted SQL derives `kb_node.kind` from it, so a directive
# naming an endpoint by key is naming its kind too.
KIND_BY_PREFIX = {
    "table": "table",
    "column": "column",
    "dataset": "dataset",
    "migration": "migration",
    "script": "ingestion_script",
    "doc": "document",
}


def read_directives(graph: Graph, text: str, source_kind: str, ref: str) -> None:
    """Apply any `-- lineage: <src-key> <relation> <dst-key>` lines in one file.

    Read from the raw text, before comment stripping — the directive *is* a comment. Both
    endpoints are named in full, so this adds nothing the file does not literally say; an
    unrecognized prefix or relation is skipped rather than guessed at.
    """
    for src, relation, dst in LINEAGE_DIRECTIVE_RE.findall(text):
        if relation not in RELATIONS:
            print(f"-- {ref}: unknown lineage relation {relation!r}, skipped", file=sys.stderr)
            continue
        for key in (src, dst):
            prefix = key.split(":", 1)[0]
            if prefix not in KIND_BY_PREFIX:
                print(f"-- {ref}: unknown lineage node key {key!r}, skipped", file=sys.stderr)
                break
        else:
            for key in (src, dst):
                prefix, _, label = key.partition(":")
                graph.node(key, KIND_BY_PREFIX[prefix], label, None, source_kind, ref)
            graph.edge(src, relation, dst, source_kind, ref, "declared")


def read_migrations(graph: Graph) -> tuple[set[str], dict[str, str]]:
    """Tables and the migrations that built them. Returns (known tables, table → first migration)."""
    known: set[str] = set()
    first_migration: dict[str, str] = {}

    for path in sorted(MIGRATIONS.glob("*.sql")):
        sql = path.read_text()
        # The table and view scans read STRIPPED sql; the docs/ scan reads RAW. The asymmetry is
        # deliberate and is the whole point of doing this separately.
        #
        # A migration header in this repository is prose, and prose says things like "RLS in the
        # same statement block as each CREATE TABLE with no anon policy" — which a raw scan reads
        # as a table named `with` and asserts into the graph. That is the same class of error
        # DECISIONS.md records twice for this script (a quote-tracking splitter desynchronising on
        # apostrophes; an illustrative doc path asserted as a real edge): a parser reading prose as
        # data. It recurred here because the earlier fix stripped comments for the dim_dataset scan
        # only, and the table scans kept reading raw text. The view scan added by #79 is included
        # for the same reason: a header saying "CREATE VIEW ..." would assert a view that is not
        # there. (split_statements strips comments itself, so the view-lineage walk below is
        # already safe.)
        #
        # The docs/ scan must NOT be stripped: a migration's citation of the write-up that
        # reconciled its data lives in the header comment, which is exactly where it belongs. That
        # scan looks for a `docs/*.md` path, which prose cannot produce by accident.
        statements = strip_sql_comments(sql)
        name = path.name
        ref = f"supabase/migrations/{name}"
        created = [t.lower() for t in CREATE_TABLE_RE.findall(statements)]
        views = [v.lower() for v in CREATE_VIEW_RE.findall(statements)]
        altered = [t.lower() for t in ALTER_TABLE_RE.findall(statements)]
        docs = sorted(set(DOC_PATH_RE.findall(sql)))
        touched = created + views + altered
        if not touched and "dim_dataset" not in sql and "lineage:" not in sql:
            continue

        migration_key = graph.node(f"migration:{name}", "migration", name, None, "migration", ref)
        read_directives(graph, sql, "migration", ref)

        for table in created:
            known.add(table)
            first_migration.setdefault(table, name)
            table_key = graph.node(f"table:{table}", "table", table, None, "migration", ref)
            graph.edge(table_key, "built-by", migration_key, "migration", ref, "create table")

        # A view's own defining query is its lineage, and unlike a table's it is right there in
        # the statement that creates it — the same statement-scoped read that `read_ingestion`
        # already trusts for `.sql`, so the edge is checkable by opening one CREATE VIEW.
        for statement in split_statements(sql):
            view_match = CREATE_VIEW_RE.search(statement)
            if not view_match:
                continue
            view = view_match.group(1).lower()
            known.add(view)
            first_migration.setdefault(view, name)
            view_key = graph.node(f"table:{view}", "table", view, None, "migration", ref)
            graph.edge(view_key, "built-by", migration_key, "migration", ref, "create view")
            for source in sorted({t.lower() for t in READ_RE.findall(statement)} - {view}):
                if source in known:
                    graph.edge(view_key, "derived-from", f"table:{source}", "migration", ref, "view query")

        for table in altered:
            known.add(table)
            table_key = graph.node(f"table:{table}", "table", table, None, "migration", ref)
            graph.edge(table_key, "built-by", migration_key, "migration", ref, "alter table")

        # A docs/ path in a migration header is that migration's own citation for the table it
        # builds — the write-up that reconciled the data, per the 1.6 discipline in DECISIONS.md.
        for doc in docs:
            doc_key = graph.node(f"doc:{doc}", "document", doc, None, "migration", ref)
            for table in dict.fromkeys(touched):
                graph.edge(f"table:{table}", "reconciled-in", doc_key, "migration", ref)

        # Read the slug out of the column position the insert itself names, rather than pattern
        # matching for something slug-shaped: source names and dates in the same tuple look enough
        # like slugs to produce datasets that do not exist.
        for columns, values_block in DATASET_INSERT_RE.findall(statements):
            column_names = [c.strip().lower() for c in columns.split(",")]
            if "slug" not in column_names:
                continue
            slug_index = column_names.index("slug")
            name_index = column_names.index("name") if "name" in column_names else None
            # `on conflict (slug) do update …` trails the values block and parses as another tuple.
            values_block = re.split(r"\bon\s+conflict\b", values_block, flags=re.I)[0]
            for fields in split_tuples(values_block):
                if len(fields) != len(column_names):
                    continue
                slug = unquote(fields[slug_index])
                if not slug:
                    continue
                label = unquote(fields[name_index]) if name_index is not None and len(fields) > name_index else slug
                graph.node(f"dataset:{slug}", "dataset", slug, label, "migration", ref)
                # The dataset's own source field names the issuance that published it. This is the
                # edge that lets one traversal cross from the registry into the document corpus
                # (Increment 3.3): the ISSUANCE node is extracted from the cue cards, this EDGE is
                # asserted by a committed migration, and each row says which it is (§9.9).
                for issuance in issuance_keys(" ".join(fields)):
                    graph.edge(f"dataset:{slug}", "defined-by", f"issuance:{issuance}",
                               "migration", ref, "dataset source field")

        # A table comment is the table's own statement of what it holds, and several of them name
        # the circular that published it. Same crossing edge, anchored on the table instead.
        for table, comment in COMMENT_ON_TABLE_RE.findall(statements):
            for issuance in issuance_keys(comment):
                graph.edge(f"table:{table.lower()}", "defined-by", f"issuance:{issuance}",
                           "migration", ref, "table comment")

    return known, first_migration


def read_registry_seed(graph: Graph, known: set[str]) -> None:
    """The 1.2 registry restated as edges: source dataset, write-up, and join keys."""
    seeds = sorted(MIGRATIONS.glob("*_seed_dataset_registry.sql"))
    if not seeds:
        print("-- no dataset registry seed found; skipping registry-derived edges", file=sys.stderr)
        return

    path = seeds[-1]
    ref = f"supabase/migrations/{path.name}"
    sql = path.read_text()

    for statement in split_statements(sql):
        if "insert into dataset_registry" in statement.lower():
            for fields in split_tuples(statement.split("values", 1)[-1]):
                if len(fields) < 11:
                    continue
                table, _title, _summary, _grain, slug, _exposure = (unquote(f) for f in fields[:6])
                doc_path = unquote(fields[10])
                if not table:
                    continue
                table_key = graph.node(f"table:{table}", "table", table, None, "registry", ref)
                if slug:
                    dataset_key = graph.node(f"dataset:{slug}", "dataset", slug, None, "registry", ref)
                    graph.edge(table_key, "derived-from", dataset_key, "registry", ref, "registered source dataset")
                if doc_path:
                    doc_key = graph.node(f"doc:{doc_path}", "document", doc_path, None, "registry", ref)
                    graph.edge(table_key, "reconciled-in", doc_key, "registry", ref)

        elif "insert into dataset_column" in statement.lower():
            for fields in split_tuples(statement.split("from (values", 1)[-1]):
                if len(fields) < 11:
                    continue
                table, column = unquote(fields[0]), unquote(fields[1])
                is_join_key, joins_to = fields[8].strip().lower() == "true", unquote(fields[9])
                if not table or not column or not is_join_key or not joins_to:
                    continue
                if table not in known:
                    continue
                column_key = graph.node(f"column:{table}.{column}", "column", f"{table}.{column}", None, "registry", ref)
                graph.edge(f"table:{table}", "has-column", column_key, "registry", ref, "join key")

                target_table = joins_to.split(".")[0]
                if target_table not in known:
                    continue
                target_key = graph.node(f"column:{joins_to}", "column", joins_to, None, "registry", ref)
                graph.edge(f"table:{target_table}", "has-column", target_key, "registry", ref, "join target")
                graph.edge(column_key, "joins-on", target_key, "registry", ref)


def read_ingestion(graph: Graph, known: set[str]) -> None:
    """Which script writes which table, and which tables that write reads from."""
    for path in sorted([*INGESTION.glob("*.py"), *INGESTION.glob("*.sql")]):
        if path.name == Path(__file__).name:
            continue
        text = path.read_text()
        ref = f"ingestion/{path.name}"
        script_key = graph.node(f"script:{ref}", "ingestion_script", path.name, None, "ingestion_script", ref)
        read_directives(graph, text, "ingestion_script", ref)

        wrote_any = False
        statements = split_statements(text) if path.suffix == ".sql" else [text]

        # Working tables (`_agg_base`) are not registered tables, so a read of one is resolved to
        # what *it* reads. Without this, agg_bhw_counts' lineage stops at a table that is dropped
        # at the end of the run.
        temp_sources: dict[str, set[str]] = {}
        for statement in statements:
            temp = TEMP_TABLE_RE.search(statement)
            if temp:
                temp_sources[temp.group(1).lower()] = {
                    t.lower() for t in READ_RE.findall(statement) if t.lower() in known
                }

        for statement in statements:
            written = {
                table.lower()
                for pattern in WRITE_RES
                for table in pattern.findall(statement)
                if table.lower() in known
            }
            if not written:
                continue
            wrote_any = True

            read: set[str] = set()
            for candidate in READ_RE.findall(statement):
                candidate = candidate.lower()
                if candidate in known:
                    read.add(candidate)
                elif candidate in temp_sources:
                    read |= temp_sources[candidate]

            for table in sorted(written):
                graph.edge(f"table:{table}", "built-by", script_key, "ingestion_script", ref, "writes")
                # `derived-from` only from SQL. In a .sql file a read can be scoped to the very
                # statement that writes; in a Python file the whole module is one blob, so every
                # table it mentions anywhere would attach to every table it writes. That is not
                # lineage, it is co-occurrence, and an edge nobody can check by reading one
                # statement is exactly what this increment exists not to produce.
                if path.suffix != ".sql":
                    continue
                for source in sorted(read - written):
                    graph.edge(f"table:{table}", "derived-from", f"table:{source}", "ingestion_script", ref)

        if not wrote_any and not graph.references(script_key):
            # A script that writes nothing this parse can see is still a real node (it may emit SQL
            # files, or reconcile without loading) — but it gets no edges it did not earn.
            #
            # The reference check is what makes `-- lineage:` usable from a Python file at all.
            # A script whose writes go through a helper (`insert_statement(table, ...)`, table name
            # a loop variable) has no `insert into <name>` for the parse to find, so wrote_any is
            # false — and popping the node then orphaned the very edges the directive had just
            # declared. The emitted SQL joins edges to nodes by key, so those edges did not fail
            # loudly; they silently did not insert, which is the failure mode this generator is
            # built to avoid. build_legislative_districts.py is the first script to hit it.
            graph.nodes.pop(f"script:{ref}", None)


def emit(graph: Graph) -> str:
    """Emit the seed.

    Compact by construction: a node's `key` already encodes its kind and its label
    ('table:agg_bhw_counts'), and every row's provenance path repeats across dozens of rows. Both
    are therefore derived in SQL — from the key prefix and from a small `refs` table — rather than
    restated per row. That keeps the file readable and, more to the point, keeps kind, label and
    key from drifting apart in a generated file nobody reads end to end.
    """
    refs: dict[str, str] = {}

    def ref_id(source_ref: str, source_kind: str) -> str:
        if source_ref not in refs:
            refs[source_ref] = f"r{len(refs) + 1}"
        return refs[source_ref]

    node_rows = []
    for node in sorted(graph.nodes.values(), key=lambda n: (n["kind"], n["key"])):
        node_rows.append((node["key"], ref_id(node["source_ref"], node["source_kind"]), node["source_kind"]))
    edge_rows = []
    for edge in sorted(graph.edges.values(), key=lambda e: (e["relation"], e["src"], e["dst"])):
        edge_rows.append(
            (edge["src"], edge["relation"], edge["dst"], ref_id(edge["source_ref"], edge["source_kind"]),
             edge["source_kind"], edge["note"])
        )

    ref_kind = {}
    for node in graph.nodes.values():
        ref_kind[refs[node["source_ref"]]] = (node["source_ref"], node["source_kind"])
    for edge in graph.edges.values():
        ref_kind.setdefault(refs[edge["source_ref"]], (edge["source_ref"], edge["source_kind"]))

    lines = [
        "-- Internal AI assistant, Increment 1.5 (docs/AI_ASSISTANT_PLAN.md §8): the lineage seed.",
        "--",
        "-- GENERATED by ingestion/build_kb_lineage.py from this repository's own migrations,",
        "-- ingestion scripts and dataset registry. Do not edit by hand — re-run the generator.",
        "-- Every row is derivable from a committed file and checkable by opening the file it names;",
        "-- no node or edge here was produced by extraction or by a model reading prose, which is why",
        "-- they all land origin 'asserted' rather than the 'extracted' default.",
        "--",
        "-- Node kind and label are derived from the key ('table:agg_bhw_counts'), and provenance",
        "-- paths from the refs list below, so nothing is restated per row and nothing can drift.",
        "with refs (ref, source_ref, source_kind) as (values",
    ]
    lines.append(",\n".join(
        f"  ({sql_literal(rid)}, {sql_literal(path)}, {sql_literal(kind)})"
        for rid, (path, kind) in sorted(ref_kind.items(), key=lambda kv: int(kv[0][1:]))
    ))
    lines.append("),")
    lines.append("node_input (key, ref) as (values")
    lines.append(",\n".join(f"  ({sql_literal(key)}, {sql_literal(rid)})" for key, rid, _ in node_rows))
    lines.append(")")
    lines.append("insert into kb_node (key, kind, label, origin, source_kind, source_ref, status)")
    lines.append("select n.key,")
    lines.append("  case split_part(n.key, ':', 1)")
    lines.append("    when 'table' then 'table' when 'column' then 'column' when 'dataset' then 'dataset'")
    lines.append("    when 'migration' then 'migration' when 'script' then 'ingestion_script'")
    lines.append("    when 'doc' then 'document' end,")
    lines.append("  substr(n.key, strpos(n.key, ':') + 1),")
    lines.append("  'asserted', r.source_kind, r.source_ref, 'approved'")
    lines.append("from node_input n join refs r on r.ref = n.ref")
    lines.append("on conflict (key) do update set")
    lines.append("  kind = excluded.kind, label = excluded.label, origin = excluded.origin,")
    lines.append("  source_kind = excluded.source_kind, source_ref = excluded.source_ref,")
    lines.append("  status = excluded.status, updated_at = now();")
    lines.append("")
    lines.append("with refs (ref, source_ref, source_kind) as (values")
    lines.append(",\n".join(
        f"  ({sql_literal(rid)}, {sql_literal(path)}, {sql_literal(kind)})"
        for rid, (path, kind) in sorted(ref_kind.items(), key=lambda kv: int(kv[0][1:]))
    ))
    lines.append("),")
    lines.append("edge_input (src_key, relation, dst_key, ref, note) as (values")
    lines.append(",\n".join(
        "  ({}, {}, {}, {}, {})".format(
            sql_literal(src), sql_literal(relation), sql_literal(dst), sql_literal(rid), sql_literal(note)
        )
        for src, relation, dst, rid, _kind, note in edge_rows
    ))
    lines.append(")")
    lines.append("insert into kb_edge (src_node_id, relation, dst_node_id, origin, source_kind, source_ref, note, status)")
    lines.append("select s.node_id, e.relation, d.node_id, 'asserted', r.source_kind, r.source_ref, e.note, 'approved'")
    lines.append("from edge_input e")
    lines.append("join refs r on r.ref = e.ref")
    lines.append("join kb_node s on s.key = e.src_key")
    lines.append("join kb_node d on d.key = e.dst_key")
    lines.append("on conflict (src_node_id, relation, dst_node_id) do update set")
    lines.append("  origin = excluded.origin, source_kind = excluded.source_kind,")
    lines.append("  source_ref = excluded.source_ref, note = excluded.note,")
    lines.append("  status = excluded.status, updated_at = now();")
    return "\n".join(lines) + "\n"


def main() -> None:
    graph = Graph()
    known, _first_migration = read_migrations(graph)
    read_registry_seed(graph, known)
    read_ingestion(graph, known)

    kinds: dict[str, int] = {}
    for node in graph.nodes.values():
        kinds[node["kind"]] = kinds.get(node["kind"], 0) + 1
    relations: dict[str, int] = {}
    for edge in graph.edges.values():
        relations[edge["relation"]] = relations.get(edge["relation"], 0) + 1

    print(f"-- nodes: {len(graph.nodes)} ({', '.join(f'{k} {v}' for k, v in sorted(kinds.items()))})")
    print(f"-- edges: {len(graph.edges)} ({', '.join(f'{k} {v}' for k, v in sorted(relations.items()))})")
    print(emit(graph), end="")

    # A table node with no `built-by` edge is a finding: something in this repository refers to a
    # table that no committed migration or ingestion script accounts for.
    built = {e["src"] for e in graph.edges.values() if e["relation"] == "built-by"}
    unbuilt = sorted(k for k, n in graph.nodes.items() if n["kind"] == "table" and k not in built)
    if unbuilt:
        print(f"tables with no built-by edge: {', '.join(unbuilt)}", file=sys.stderr)

    # An edge whose endpoint this script never defines. The emitted SQL joins edges to nodes by
    # key, so such an edge does not fail — it simply does not insert, and the graph quietly comes
    # out smaller than the file claims. `issuance:` endpoints are the one legitimate case (they
    # come from document extraction) and are reported separately below; anything else is a bug in
    # this generator, and was one: a directive-declared `built-by` on a script whose node had been
    # dropped as unearned. Nothing said so until the delta was counted by hand.
    dangling = sorted(
        {e for edge in graph.edges.values() for e in (edge["src"], edge["dst"])}
        - set(graph.nodes)
        - {k for k in {e for edge in graph.edges.values() for e in (edge["src"], edge["dst"])}
           if k.startswith("issuance:")}
    )
    if dangling:
        print(
            "edges name endpoints this generator does not define, so they will not load: "
            f"{', '.join(dangling)}",
            file=sys.stderr,
        )

    # A crossing edge (Increment 3.3) names an `issuance:` node this script does not define — the
    # node comes from document extraction, and the emitted seed joins to it by key. The join drops
    # an edge whose node is absent, which is correct and silent, so the absence is reported here
    # instead. Checked against the committed extraction transcripts, which are the only committed
    # statement of which issuances the corpus actually yields.
    proposed = set()
    for transcript in sorted(EXTRACTIONS.glob("kb_extraction_*.jsonl")):
        for line in transcript.read_text().splitlines():
            if not line.strip():
                continue
            for node in (json.loads(line).get("proposal") or {}).get("nodes") or []:
                if isinstance(node.get("key"), str) and node["key"].startswith("issuance:"):
                    proposed.add(node["key"])
    missing = sorted(
        {e["dst"] for e in graph.edges.values() if e["dst"].startswith("issuance:")} - proposed
    )
    if missing:
        print(
            "issuances named by a migration that no extraction proposes "
            f"(their crossing edges will not load): {', '.join(missing)}",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
