"""Ingest a document corpus into doc_source / doc_chunk (docs/AI_ASSISTANT_PLAN.md §8, 2.1).

Chunking and embedding happen HERE, in the local pipeline, never in a Vercel function. That is
the plan's instruction and it is also the only shape that works: this pipeline is already
local-only per the README, which sidesteps serverless timeouts entirely, and a 213-slide
extraction plus an embedding round-trip per slide is not a request-scoped workload.

    python ingestion/ingest_documents.py --verify                     # extract + QA, no DB, no key
    python ingestion/ingest_documents.py --emit-sql-dir out/
    python ingestion/ingest_documents.py --database-url "$DATABASE_URL"
    python ingestion/ingest_documents.py --database-url "$DATABASE_URL" --embed

`--embed` is a separate flag because the two halves have different requirements. Extraction needs
only the committed PDF, so it runs and is verifiable anywhere; embedding needs a provider key and
network. Splitting them means a corpus can be loaded, inspected and searched by trigram before any
embedding exists, and re-embedded onto a new model later without re-extracting.

WHAT THIS ASSERTS, AND WHAT IT REFUSES TO ASSUME
------------------------------------------------
* The embedding model id comes from GEMINI_EMBEDDING_MODEL. There is no default and no fallback
  constant (§1: "the model name is configuration, not code" — this project has already lost a day
  to a pinned model that was shut down).
* The embedding DIMENSION is measured from the vector the live model returns, then written to
  doc_embedding_model.dim. It is never read from documentation and never hard-coded. §11 asks for
  it to be confirmed against the live model at implementation time; measuring it is the only way
  to do that which stays true after the provider changes it.
* Page offsets are computed, then re-checked against the canonical text before anything is
  emitted. Increment 2.3 makes citation accuracy a correctness requirement (§7), so an offset this
  script cannot round-trip is a hard failure, not a warning.

THE SLIDE-NUMBER ELEMENT (§12.3)
--------------------------------
§12.3 records that the deck's own slide numbers sit in the text layer and bleed into extracted
text. That hazard is real; this is its exact mechanism in this file, measured rather than assumed:

  * One font family in the whole deck is below 5pt: 3.0pt "38,Bold" — 148 spans.
  * Every one of them is at x = 325.9, and every one is a single digit.
  * They are stacked vertically, one digit per span, and spell the deck's own printed slide
    number: PDF page 37 carries "42", page 157 "190", page 163 "196".
  * They appear on 52 of 213 pages, and those 52 numbers increase monotonically. The offset from
    the PDF page index runs from +4 to +33, so the printed number is NOT derivable — which is why
    citations below use the PDF page number, the same numbering §12 itself uses (p37 = the UUC
    distribution slide).

Body text never falls below 7pt, so `size < MIN_SPAN_PT` isolates this element exactly. It is
dropped by that signature before any line is assembled.

Two corrections to §12.3, recorded because the plan presents them as evidence:

  1. The corruption reproduces only under a FLAT sorted extraction (PyMuPDF `get_text(sort=True)`).
     Line-structured, span-aware extraction — what this script does — keeps the tiny spans in
     their own line objects and never merges them into a word, so it is not exposed to the hazard
     even before the strip. The strip is kept regardless: the element is not content, and left in
     it would appear as a stray digit line inside the chunk, be embedded, and be quotable.
  2. The digits land AFTER a token, not inside one, and §12.3's exact strings do not reproduce
     here: this extractor yields "MIMAROPA REGION42" and "reported19", not "MIMAROPA REG42ION" and
     "report196ed", and page 157's "workshops" is not corrupted in any mode tested. §12.3's
     examples come from a different extractor. The hazard stands; those three strings do not.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "ingestion" / "data"

# Spans below this point size are not body text. Measured, not guessed: the smallest real text in
# the cue cards is 7pt, and the only sub-5pt family is the slide-number element documented above.
MIN_SPAN_PT = 5.0

# Joins page texts into the document's canonical text. A form feed cannot occur in extracted text
# (asserted below), so the concatenation is unambiguously reversible.
PAGE_SEPARATOR = "\f"

# Slide furniture that identifies the deck rather than the slide. Skipped when choosing a heading
# so a citation reads "slide 37 — SUMMARY" rather than "slide 37 — Republic of the Philippines".
BOILERPLATE_HEADINGS = {
    "republic of the philippines",
    "department of health",
    "/doh.gov.ph",
    "bureau of local health systems development",
    "program",
    "profile",
    "program profile",
}

CORPUS = {
    "key": "blhsd-2027-budget-cue-cards",
    "title": "[BLHSD] 2027 Budget Cue Cards",
    "file": "[BLHSD] 2027 Budget Cue Cards.pdf",
    "issuer": "Bureau of Local Health Systems Development, Department of Health",
    # The latest as-of date the deck states about its own contents (p160-168, JMC 2023-001 BHW
    # retention status "as of 18 Sept 2025"). Drives §12.4 rule 2 — attributed AND dated.
    "as_of": "2025-09-18",
    "exposure": "internal",
    "notes_md": (
        "Internal budget material (2027 NEP proposal). Plan section 12.5: admin-only exposure is "
        "load-bearing for this corpus specifically -- slide 26 records the BHW Connect site under "
        "system hold by KMITS. Clearance to load is not clearance to expose; guardrail 9.1 is "
        "unchanged.\n\n"
        "Slide 26 asserts 277,767 registered and accredited BHWs as of Dec 2025, against 270,917 "
        "records behind SQL. Plan section 12.4: these are different measures at different dates, "
        "not a contradiction to resolve. A number carried by this document is admissible only "
        "when its citation resolves to the chunk, must render attributed and dated, and must be "
        "surfaced alongside -- never in place of -- the SQL figure where the two disagree.\n\n"
        "Extraction drops a 3.0pt slide-number element (see ingestion/ingest_documents.py)."
    ),
}


# --------------------------------------------------------------------------------------------
# Extraction
# --------------------------------------------------------------------------------------------

def extract_pages(pdf_path: Path) -> tuple[list[str], list[dict], str]:
    """Return (page_texts, dropped_spans, extractor_id).

    Line-structured and span-aware: spans are filtered, then lines assembled, then blocks
    separated by a blank line. Reading order comes from PyMuPDF's own block sort.
    """
    import pymupdf

    extractor = f"pymupdf {pymupdf.__version__} (dict, sort=True, spans < {MIN_SPAN_PT}pt dropped)"
    doc = pymupdf.open(pdf_path)
    page_texts: list[str] = []
    dropped: list[dict] = []

    for pno in range(doc.page_count):
        blocks_out: list[str] = []
        for block in doc[pno].get_text("dict", sort=True)["blocks"]:
            if block["type"] != 0:  # image or drawing, no text layer
                continue
            lines_out: list[str] = []
            for line in block["lines"]:
                kept: list[str] = []
                for span in line["spans"]:
                    if not span["text"].strip():
                        continue
                    if span["size"] < MIN_SPAN_PT:
                        dropped.append({
                            "page": pno + 1,
                            "text": span["text"].strip(),
                            "size": round(span["size"], 2),
                            "font": span["font"],
                            "x": round(span["bbox"][0], 1),
                        })
                        continue
                    kept.append(span["text"])
                line_text = "".join(kept).rstrip()
                if line_text.strip():
                    lines_out.append(line_text)
            if lines_out:
                blocks_out.append("\n".join(lines_out))
        page_texts.append("\n\n".join(blocks_out))

    doc.close()
    return page_texts, dropped, extractor


def pick_heading(page_text: str) -> str | None:
    """First line of the slide that names the slide rather than the deck."""
    for line in page_text.split("\n"):
        candidate = line.strip()
        if len(candidate) < 3:
            continue
        if candidate.lower().strip(" -:") in BOILERPLATE_HEADINGS:
            continue
        return candidate[:200]
    return None


def build_chunks(page_texts: list[str]) -> tuple[str, list[dict]]:
    """One slide, one chunk (plan section 12.3), with offsets into the canonical document text.

    The offsets are the point of this function. They are computed here and asserted against the
    text they claim to index before being returned, because Increment 2.3 makes a citation the
    only check a prose claim gets -- a citation that points at the wrong span reads as verified
    and is worse than none at all.
    """
    for pno, text in enumerate(page_texts, 1):
        if PAGE_SEPARATOR in text:
            raise SystemExit(f"page {pno} contains the page separator; the canonical text would be ambiguous")

    full_text = PAGE_SEPARATOR.join(page_texts)
    chunks: list[dict] = []
    cursor = 0

    for index, text in enumerate(page_texts):
        start, end = cursor, cursor + len(text)
        chunks.append({
            "chunk_index": index,
            "page_from": index + 1,
            "page_to": index + 1,
            "char_start": start,
            "char_end": end,
            "content": text,
            "content_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            "heading": pick_heading(text),
        })
        cursor = end + len(PAGE_SEPARATOR)

    assert_offsets(full_text, chunks)
    return full_text, chunks


def assert_offsets(full_text: str, chunks: list[dict]) -> None:
    """Every stored offset must round-trip against the text it indexes. Hard failure, not a warning."""
    for chunk in chunks:
        sliced = full_text[chunk["char_start"]:chunk["char_end"]]
        if sliced != chunk["content"]:
            raise SystemExit(
                f"offset round-trip failed on chunk {chunk['chunk_index']} "
                f"(page {chunk['page_from']}): [{chunk['char_start']}:{chunk['char_end']}] "
                f"does not reproduce the stored content"
            )
        if chunk["char_end"] - chunk["char_start"] != len(chunk["content"]):
            raise SystemExit(f"offset span disagrees with content length on chunk {chunk['chunk_index']}")


# --------------------------------------------------------------------------------------------
# Embedding
# --------------------------------------------------------------------------------------------

EMBED_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent"


def embed_chunks(chunks: list[dict]) -> dict:
    """Embed every chunk, and MEASURE the dimension rather than declaring it.

    Returns {"model", "provider", "dim", "distance", "vectors": {chunk_index: [float, ...]}}.

    Owner decision 7 puts embeddings on Gemini, the same key and cascade as chat. The model id is
    read from the environment with no default: a constant here is the failure this project has
    already paid for once.
    """
    import urllib.error
    import urllib.request

    api_key = os.environ.get("GEMINI_API_KEY")
    model = os.environ.get("GEMINI_EMBEDDING_MODEL")
    if not api_key:
        raise SystemExit("--embed needs GEMINI_API_KEY in the environment")
    if not model:
        raise SystemExit(
            "--embed needs GEMINI_EMBEDDING_MODEL in the environment. There is deliberately no "
            "default: plan section 1 requires the model name to be configuration, not code."
        )

    # Optional. When set it is REQUESTED via outputDimensionality, and the response is still
    # measured -- a provider that returns a different width fails here rather than at insert.
    requested_dim = os.environ.get("GEMINI_EMBEDDING_DIM")
    requested_dim = int(requested_dim) if requested_dim else None

    url = EMBED_ENDPOINT.format(model=model)
    vectors: dict[int, list[float]] = {}
    measured_dim: int | None = None

    for chunk in chunks:
        # A slide with no text layer (page 172 of the cue cards is one) has nothing to embed, and
        # most providers reject an empty input outright. It keeps its chunk row -- dropping it
        # would break the one-slide-one-chunk alignment between chunk_index and page number -- and
        # is simply absent from the vector table, where a missing row is the honest state.
        if not chunk["content"].strip():
            print(f"[embed] skipping chunk {chunk['chunk_index']} (page {chunk['page_from']}): no text")
            continue

        body: dict = {
            "model": f"models/{model}",
            "content": {"parts": [{"text": chunk["content"]}]},
            "taskType": "RETRIEVAL_DOCUMENT",
        }
        if requested_dim:
            body["outputDimensionality"] = requested_dim

        request = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = json.load(response)
        except urllib.error.HTTPError as exc:  # surface the provider's own message, not a stack
            raise SystemExit(f"embedding failed on chunk {chunk['chunk_index']}: {exc.read().decode()[:500]}")

        values = payload["embedding"]["values"]
        if measured_dim is None:
            measured_dim = len(values)
            print(f"[embed] {model}: measured dimension {measured_dim}"
                  + (f" (requested {requested_dim})" if requested_dim else ""))
        elif len(values) != measured_dim:
            raise SystemExit(
                f"chunk {chunk['chunk_index']} returned {len(values)} dimensions, "
                f"but the first chunk returned {measured_dim}"
            )
        if requested_dim and measured_dim != requested_dim:
            raise SystemExit(
                f"requested {requested_dim} dimensions via outputDimensionality but the model "
                f"returned {measured_dim}; refusing to store a width nobody asked for"
            )

        # L2-normalise so cosine distance equals dot product and stays comparable across a
        # dimension change. A no-op for a model that already returns unit vectors, and required
        # for one that does not -- Gemini's reduced-dimensionality output is not normalised.
        norm = sum(v * v for v in values) ** 0.5
        vectors[chunk["chunk_index"]] = [v / norm for v in values] if norm else values

    if measured_dim is None:
        raise SystemExit("no chunk had text to embed")

    return {
        "model": model,
        "provider": "gemini",
        "dim": measured_dim,
        "distance": "cosine",
        "vectors": vectors,
    }


# --------------------------------------------------------------------------------------------
# SQL
# --------------------------------------------------------------------------------------------

def sql_literal(value) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def sql_for_source(source: dict) -> str:
    """Upsert on `key`, so a re-run updates rather than duplicates."""
    columns = ["key", "title", "source_path", "source_sha256", "media_type", "page_count",
               "char_count", "issuer", "as_of", "extractor", "exposure", "status", "notes_md"]
    values = ", ".join(sql_literal(source[c]) for c in columns)
    updates = ", ".join(f"{c} = excluded.{c}" for c in columns if c != "key")
    return (
        f"insert into doc_source ({', '.join(columns)})\nvalues ({values})\n"
        f"on conflict (key) do update set {updates}, updated_at = now();\n"
    )


def sql_for_chunks(doc_key: str, chunks: list[dict]) -> str:
    """Upsert on (doc_id, chunk_index). doc_id is resolved by key, never hard-coded."""
    columns = ["chunk_index", "page_from", "page_to", "char_start", "char_end",
               "content", "content_sha256", "heading"]
    rows = ",\n  ".join(
        "((select doc_id from doc_source where key = " + sql_literal(doc_key) + "), "
        + ", ".join(sql_literal(chunk[c]) for c in columns) + ")"
        for chunk in chunks
    )
    updates = ", ".join(f"{c} = excluded.{c}" for c in columns if c != "chunk_index")
    return (
        f"insert into doc_chunk (doc_id, {', '.join(columns)})\nvalues\n  {rows}\n"
        f"on conflict (doc_id, chunk_index) do update set {updates}, updated_at = now();\n"
    )


def sql_for_embeddings(doc_key: str, embedded: dict) -> str:
    """The model row carries the MEASURED dimension; every vector row points at it."""
    statements = [
        "insert into doc_embedding_model (model, provider, dim, distance, notes_md)\nvalues ("
        + ", ".join(sql_literal(v) for v in (
            embedded["model"], embedded["provider"], embedded["dim"], embedded["distance"],
            "Dimension measured from a live response by ingestion/ingest_documents.py; "
            "vectors are L2-normalised.",
        ))
        + ")\non conflict (model) do update set provider = excluded.provider, "
          "dim = excluded.dim, distance = excluded.distance, notes_md = excluded.notes_md;\n"
    ]
    rows = ",\n  ".join(
        "((select c.chunk_id from doc_chunk c join doc_source s on s.doc_id = c.doc_id "
        f"where s.key = {sql_literal(doc_key)} and c.chunk_index = {index}), "
        f"{sql_literal(embedded['model'])}, {embedded['dim']}, "
        f"'[{','.join(f'{v:.8g}' for v in vector)}]')"
        for index, vector in sorted(embedded["vectors"].items())
    )
    statements.append(
        f"insert into doc_chunk_embedding (chunk_id, model, dim, embedding)\nvalues\n  {rows}\n"
        "on conflict (chunk_id, model) do update set dim = excluded.dim, "
        "embedding = excluded.embedding, embedded_at = now();\n"
    )
    return "\n".join(statements)


# --------------------------------------------------------------------------------------------

def batched(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def batched_by_bytes(chunks: list[dict], max_bytes: int):
    """Batch chunk rows by emitted size rather than row count.

    Slide length varies by more than an order of magnitude in this deck (24 chars to ~4,000), so a
    fixed row count produces wildly uneven statements. Some transports -- psycopg2 is fine, but a
    console or an MCP bridge may not be -- have a practical per-statement ceiling, and a batch
    sized in bytes stays under it whatever the corpus looks like.
    """
    batch: list[dict] = []
    size = 0
    for chunk in chunks:
        cost = len(chunk["content"]) + 220  # 220 ~= the per-row scaffolding around the text
        if batch and size + cost > max_bytes:
            yield batch
            batch, size = [], 0
        batch.append(chunk)
        size += cost
    if batch:
        yield batch


def selftest() -> None:
    sized = [{"content": "x" * 400}, {"content": "y" * 400}, {"content": "z" * 400}]
    assert [len(b) for b in batched_by_bytes(sized, 1300)] == [2, 1]
    assert [len(b) for b in batched_by_bytes(sized, 10)] == [1, 1, 1], "one oversized row still emits"
    full, chunks = build_chunks(["alpha", "", "gamma delta"])
    assert [c["char_start"] for c in chunks] == [0, 6, 7], chunks
    assert [c["char_end"] for c in chunks] == [5, 6, 18], chunks
    assert full[chunks[2]["char_start"]:chunks[2]["char_end"]] == "gamma delta"
    assert chunks[1]["content"] == "" and chunks[1]["heading"] is None
    assert pick_heading("DEPARTMENT OF HEALTH\nSUMMARY\nrest") == "SUMMARY"
    assert pick_heading("Republic of the Philippines\n/doh.gov.ph\nKEY PROCESSES") == "KEY PROCESSES"
    try:
        build_chunks(["ok", "bad\fpage"])
    except SystemExit:
        pass
    else:
        raise AssertionError("a page containing the separator must be refused")
    assert sql_literal("O'Brien") == "'O''Brien'" and sql_literal(None) == "null"
    print("ingest_documents selftest: OK")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--database-url")
    ap.add_argument("--emit-sql-dir")
    ap.add_argument("--verify", action="store_true", help="offline: extract and report only")
    ap.add_argument("--embed", action="store_true", help="also embed (needs GEMINI_API_KEY)")
    ap.add_argument("--selftest", action="store_true", help="run helper assertions and exit")
    ap.add_argument("--batch-bytes", type=int, default=60000,
                    help="approximate emitted size of each doc_chunk statement")
    args = ap.parse_args()

    if args.selftest:
        selftest()
        return

    pdf_path = DATA / CORPUS["file"]
    if not pdf_path.exists():
        ap.error(f"missing corpus file: {pdf_path}")

    page_texts, dropped, extractor = extract_pages(pdf_path)
    full_text, chunks = build_chunks(page_texts)

    source = dict(
        key=CORPUS["key"],
        title=CORPUS["title"],
        source_path=str(pdf_path.relative_to(REPO)),
        source_sha256=hashlib.sha256(pdf_path.read_bytes()).hexdigest(),
        media_type="application/pdf",
        page_count=len(page_texts),
        char_count=len(full_text),
        issuer=CORPUS["issuer"],
        as_of=CORPUS["as_of"],
        extractor=extractor,
        exposure=CORPUS["exposure"],
        # Hand-authored corpus metadata, extraction checked by the assertions above: approved, the
        # same standing the 1.2 registry rows have. Owner decision 5 gates *extraction* output.
        status="approved",
        notes_md=CORPUS["notes_md"],
    )

    empty = [c["page_from"] for c in chunks if not c["content"].strip()]
    dropped_by_page: dict[int, str] = {}
    for span in dropped:
        dropped_by_page[span["page"]] = dropped_by_page.get(span["page"], "") + span["text"]

    print(f"{CORPUS['key']}: {len(chunks)} chunks over {len(page_texts)} pages, "
          f"{len(full_text):,} chars ({len(full_text) // max(len(chunks), 1)} avg)")
    print(f"extractor: {extractor}")
    print(f"dropped slide-number spans: {len(dropped)} on {len(dropped_by_page)} pages "
          f"(sizes {sorted({s['size'] for s in dropped})}, "
          f"fonts {sorted({s['font'] for s in dropped})}, "
          f"x {sorted({s['x'] for s in dropped})})")
    if dropped_by_page:
        sample = ", ".join(f"p{p}->{v}" for p, v in sorted(dropped_by_page.items())[:5])
        print(f"  sample: {sample}")
    non_digit = [s for s in dropped if not s["text"].isdigit()]
    if non_digit:
        print(f"  WARNING: {len(non_digit)} dropped spans are not digits: {non_digit[:5]}", file=sys.stderr)
    if empty:
        print(f"pages with no extractable text: {empty}")

    if args.verify:
        return

    embedded = embed_chunks(chunks) if args.embed else None

    def statements():
        yield sql_for_source(source)
        for batch in batched_by_bytes(chunks, args.batch_bytes):
            yield sql_for_chunks(CORPUS["key"], batch)
        if embedded:
            yield sql_for_embeddings(CORPUS["key"], embedded)

    if args.emit_sql_dir:
        out = Path(args.emit_sql_dir)
        out.mkdir(parents=True, exist_ok=True)
        for i, statement in enumerate(statements(), 1):
            (out / f"{i:04d}_{CORPUS['key']}.sql").write_text(statement)
        print(f"Wrote SQL batches to {out}")
    elif args.database_url:
        import psycopg2
        conn = psycopg2.connect(args.database_url)
        try:
            with conn, conn.cursor() as cur:
                for statement in statements():
                    cur.execute(statement)
        finally:
            conn.close()
        print("Loaded via psycopg2.")
    else:
        ap.error("pass --verify, --emit-sql-dir, or --database-url")


if __name__ == "__main__":
    main()
