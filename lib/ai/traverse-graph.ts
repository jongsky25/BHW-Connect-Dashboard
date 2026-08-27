import "server-only";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/db/service-client";
import type { Tool } from "./tools";

/**
 * `traverseGraph` (docs/AI_ASSISTANT_PLAN.md §8, Increment 1.6): the walk the current tool set
 * cannot do at any depth, over the two edge shapes the repository already has.
 *
 * - **geo** — `dim_geo.parent_code`, the containment tree over 43,746 geographies. `getIndicatorByGeo`
 *   fetches one geography and `compareGeos` two named ones, so "which places inside Cebu sit below
 *   their provincial peers" — a subtree walk joined to `agg_peer_ranks` — has been unanswerable
 *   against data that has been in production for a month.
 * - **lineage** — the `kb_edge` graph: what a table derives from, what built it, which write-up
 *   reconciled it (seeded from repository structure in 1.5) and, from Increment 3.3, which
 *   issuance a dataset rests on and which programme that issuance governs — the second half of
 *   which was extracted from the document corpus and approved through the 3.2 queue.
 *
 * Increment 3.3 adds `direction: "both"`. The crossing edges meet nose to nose at an issuance —
 * a dataset declares its basis, and a programme declares the same one — so no single-direction
 * walk gets from one side to the other. With an undirected walk the relation name alone stops
 * saying which way a hop was taken, so every result now also carries `directions`, and `via`
 * renders a backwards hop as `←relation—` rather than `—relation→`. 1.6's contract is not
 * relaxed to fit the new mode; it is made precise enough to carry it.
 *
 * The recursion itself lives in `traverse_geo` / `traverse_kb` (Postgres). That is deliberate:
 * §9.8's guardrails — depth cap, visited-set cycle guard, row cap, statement timeout — are
 * enforced in the database, where they hold however the function is called, and this module adds
 * a second, earlier refusal so a bad request never reaches the database at all.
 *
 * Results are paths, never bare endpoints. A lineage answer that says "agg_honorarium comes from
 * fact_honorarium" without the chain and the file that asserts each step is not checkable, and an
 * unverifiable provenance claim is worse than none — it reads as authority.
 */

/** Mirrors the hard caps in the SQL functions; kept in sync deliberately, not derived. */
export const GEO_MAX_DEPTH = 5;
export const LINEAGE_MAX_DEPTH = 6;
/** An undirected walk fans out faster, so it gets a lower cap — §11 says raise a depth cap against
 * real questions rather than guessing upward, and this is the guess-downward end of that. */
export const LINEAGE_BOTH_MAX_DEPTH = 4;
export const MAX_TRAVERSAL_ROWS = 500;
export const DEFAULT_TRAVERSAL_ROWS = 100;
export const DEFAULT_DEPTH = 3;
export const TRAVERSAL_TIMEOUT_MS = 8000;

export const KB_RELATIONS = [
  "derived-from",
  "built-by",
  "reconciled-in",
  "joins-on",
  "has-column",
  // Increment 3.1's extraction vocabulary, plus the asserted crossing edges 3.3 derives from
  // migration text. `defined-by` carries both — a programme's legal basis and a dataset's — since
  // the relation means the same thing in each and splitting it would make one traversal two.
  "defined-by",
  "issued-by",
  "part-of",
] as const;

export const traverseArgsSchema = z.object({
  source: z.enum(["geo", "lineage"]),
  /** A geo_code for geo ('0722'), or a node key for lineage ('table:agg_honorarium'). */
  start: z.string().min(1).max(120),
  direction: z.enum(["down", "up", "out", "in", "both"]).optional(),
  relations: z.array(z.enum(KB_RELATIONS)).max(KB_RELATIONS.length).optional(),
  maxDepth: z.number().int().min(1).max(LINEAGE_MAX_DEPTH).optional(),
  limit: z.number().int().min(1).max(MAX_TRAVERSAL_ROWS).optional(),
});

export type TraverseArgs = z.infer<typeof traverseArgsSchema>;
export type TraverseError = { error: string };

export type GeoPlan = {
  source: "geo";
  fn: "traverse_geo";
  params: { start_code: string; direction: "down" | "up"; max_depth: number; row_cap: number };
};
export type LineagePlan = {
  source: "lineage";
  fn: "traverse_kb";
  params: {
    start_key: string;
    direction: "out" | "in" | "both";
    relations: string[] | null;
    max_depth: number;
    row_cap: number;
  };
};
export type TraversalPlan = GeoPlan | LineagePlan;

const GEO_DIRECTIONS = ["down", "up"] as const;
const LINEAGE_DIRECTIONS = ["out", "in", "both"] as const;

/**
 * Validates a traversal request and returns the RPC call to make, or a refusal the model can act
 * on. Pure, so every refusal path is testable without a database — and every refusal names the
 * limit, because a model told only "no" retries the same shape.
 */
export function planTraversal(args: TraverseArgs): { plan: TraversalPlan } | TraverseError {
  const limit = args.limit ?? DEFAULT_TRAVERSAL_ROWS;
  const depth = args.maxDepth ?? DEFAULT_DEPTH;

  if (args.source === "geo") {
    if (args.relations?.length) {
      return {
        error: "relations apply to the lineage graph only; a geo traversal follows containment.",
      };
    }
    const direction = args.direction ?? "down";
    if (!(GEO_DIRECTIONS as readonly string[]).includes(direction)) {
      return {
        error: `A geo traversal goes down (into a place) or up (to its ancestors), not ${direction}.`,
      };
    }
    if (depth > GEO_MAX_DEPTH) {
      return { error: `maxDepth ${depth} exceeds the geo traversal limit of ${GEO_MAX_DEPTH}.` };
    }
    return {
      plan: {
        source: "geo",
        fn: "traverse_geo",
        params: {
          start_code: args.start,
          direction: direction as "down" | "up",
          max_depth: depth,
          row_cap: limit,
        },
      },
    };
  }

  const direction = args.direction ?? "out";
  if (!(LINEAGE_DIRECTIONS as readonly string[]).includes(direction)) {
    return {
      error: `A lineage traversal goes out (what this was built from), in (what depends on it), or both (either way, for a chain that changes direction), not ${direction}.`,
    };
  }
  const ceiling = direction === "both" ? LINEAGE_BOTH_MAX_DEPTH : LINEAGE_MAX_DEPTH;
  if (depth > ceiling) {
    return {
      error: `maxDepth ${depth} exceeds the ${direction} lineage traversal limit of ${ceiling}.`,
    };
  }
  if (!args.start.includes(":")) {
    return {
      error: `A lineage traversal starts at a node key like table:agg_honorarium or dataset:bhw-2025, not ${args.start}.`,
    };
  }
  return {
    plan: {
      source: "lineage",
      fn: "traverse_kb",
      params: {
        start_key: args.start,
        direction: direction as "out" | "in" | "both",
        relations: args.relations?.length ? [...args.relations] : null,
        max_depth: depth,
        row_cap: limit,
      },
    },
  };
}

type GeoRow = {
  geo_code: string;
  geo_level: string;
  geo_name: string;
  depth: number;
  path: string[];
};
type KbRow = {
  key: string;
  kind: string;
  label: string;
  depth: number;
  path: string[];
  relation_path: string[];
  source_path: string[];
  direction_path: string[];
};

export type GeoResult = {
  geoCode: string;
  geoLevel: string;
  geoName: string;
  depth: number;
  path: string[];
};
export type LineageResult = {
  key: string;
  kind: string;
  label: string;
  depth: number;
  path: string[];
  relations: string[];
  /** The file asserting each step, in step order — the provenance the §1 ground rule requires. */
  sources: string[];
  /** Which way each step was walked: 'out' along the edge, 'in' against it. Only `both` produces
   * a mixture, but it is always returned so a reader never has to know which mode ran. */
  directions: string[];
  /** One-line rendering of the whole chain, so a cited answer can quote it verbatim. */
  via: string;
};

export type TraverseResult =
  | {
      source: "geo";
      start: string;
      direction: string;
      depth: number;
      count: number;
      truncated: boolean;
      results: GeoResult[];
    }
  | {
      source: "lineage";
      start: string;
      direction: string;
      depth: number;
      count: number;
      truncated: boolean;
      results: LineageResult[];
    };

function renderVia(row: KbRow): string {
  const steps = row.path.slice(1).map((node, i) => {
    const relation = row.relation_path[i] ?? "?";
    const source = row.source_path[i] ?? "?";
    // A backwards hop reads backwards. "defined-by → issuance:AO 2020-0023" and
    // "←defined-by— program:UUC for PHC" are opposite claims, and a chain that renders them the
    // same is a chain a reader cannot check — which 1.6 treats as worse than no chain at all.
    const arrow = row.direction_path?.[i] === "in" ? `←${relation}—` : `—${relation}→`;
    return `${arrow} ${node} [${source}]`;
  });
  return `${row.path[0]} ${steps.join(" ; ")}`;
}

/**
 * Runs one traversal. Returns a plain object on every path — a refusal, including the database's
 * own depth refusal, is data the model can react to rather than a thrown error killing the loop.
 */
export async function executeTraverseGraph(
  rawArgs: Record<string, unknown>,
): Promise<TraverseResult | TraverseError> {
  const parsed = traverseArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return {
      error: `Invalid arguments for traverseGraph: ${parsed.error.issues[0]?.message ?? "unrecognized shape"}.`,
    };
  }

  const planned = planTraversal(parsed.data);
  if ("error" in planned) return planned;
  const { plan } = planned;

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .rpc(plan.fn, plan.params as never)
      .abortSignal(AbortSignal.timeout(TRAVERSAL_TIMEOUT_MS));

    if (error) return { error: `Traversal failed: ${error.message}` };

    const rows = (data ?? []) as unknown[];
    const truncated = rows.length === plan.params.row_cap;
    const depth = plan.params.max_depth;

    if (plan.source === "geo") {
      const results = (rows as GeoRow[]).map((row) => ({
        geoCode: row.geo_code,
        geoLevel: row.geo_level,
        geoName: row.geo_name,
        depth: row.depth,
        path: row.path,
      }));
      return {
        source: "geo",
        start: plan.params.start_code,
        direction: plan.params.direction,
        depth,
        count: results.length,
        truncated,
        results,
      };
    }

    const results = (rows as KbRow[]).map((row) => ({
      key: row.key,
      kind: row.kind,
      label: row.label,
      depth: row.depth,
      path: row.path,
      relations: row.relation_path,
      sources: row.source_path,
      directions: row.direction_path ?? [],
      via: renderVia(row),
    }));
    return {
      source: "lineage",
      start: plan.params.start_key,
      direction: plan.params.direction,
      depth,
      count: results.length,
      truncated,
      results,
    };
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    return {
      error: timedOut
        ? `Traversal exceeded the ${TRAVERSAL_TIMEOUT_MS / 1000}s limit — reduce maxDepth or start lower in the tree.`
        : "Traversal could not be completed.",
    };
  }
}

/** The tool as the model sees it. Internal only: it reads kb_edge, which is service-role only. */
export function createTraversalTool(): Tool {
  return {
    definition: {
      name: "traverseGraph",
      description:
        "Walk a graph and get back paths, not just endpoints. source 'geo' walks the dim_geo containment tree — down for everything inside a place (its cities, its barangays), up for its ancestors — which is how you answer questions about a whole subtree rather than one named geography. source 'lineage' walks the knowledge graph, which spans two populations: the datasets, tables, columns, migrations and write-ups this project builds, and the programmes, issuances and agencies described in the document corpus. Go out from a node for what it rests on (what a table was derived from, what built it, which circular defines a dataset), in for what depends on it, and both when the chain changes direction — which it does whenever you cross between a dataset and the policy behind it, because a dataset and a programme each point AT the same issuance. Every lineage result carries the file or slide that asserts each step and which way it was walked; quote that chain when you describe where something comes from.",
      parameters: {
        type: "object",
        properties: {
          source: { type: "string", enum: ["geo", "lineage"] },
          start: {
            type: "string",
            description:
              "A geo_code for geo ('07022', 'PH'), or a node key for lineage ('table:agg_honorarium').",
          },
          direction: {
            type: "string",
            enum: ["down", "up", "out", "in", "both"],
            description:
              "geo: down (default) or up. lineage: out (default), in, or both (an undirected walk, for a chain that crosses from a dataset to the policy behind it).",
          },
          relations: {
            type: "array",
            items: { type: "string", enum: [...KB_RELATIONS] },
            description: "lineage only: restrict to these relations.",
          },
          maxDepth: {
            type: "number",
            description: `Steps to walk (default ${DEFAULT_DEPTH}; geo max ${GEO_MAX_DEPTH}, lineage max ${LINEAGE_MAX_DEPTH}, lineage 'both' max ${LINEAGE_BOTH_MAX_DEPTH}).`,
          },
          limit: {
            type: "number",
            description: `Rows to return, 1-${MAX_TRAVERSAL_ROWS} (default ${DEFAULT_TRAVERSAL_ROWS}).`,
          },
        },
        required: ["source", "start"],
      },
    },
    async execute(args) {
      return executeTraverseGraph(args);
    },
  };
}
