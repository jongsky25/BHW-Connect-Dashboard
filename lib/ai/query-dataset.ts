import "server-only";
import { z } from "zod";
import {
  getRegisteredDataset,
  queryableColumns,
  type Exposure,
  type RegisteredColumn,
  type RegisteredDataset,
} from "@/lib/db/dataset-registry";
import { createSupabaseServiceClient } from "@/lib/db/service-client";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * `queryDataset` (docs/AI_ASSISTANT_PLAN.md §8, Increment 1.3): one generic tool over every
 * registered table, replacing the "a new dataset means a new hand-written tool" ceiling that
 * `lib/ai/tools.ts` hits today.
 *
 * Three properties make this safe to hand a model:
 *
 * 1. **No SQL is composed anywhere.** Table and column names are looked up in the registry and
 *    passed to PostgREST as identifiers; filter values go through supabase-js as parameters.
 *    There is no string a user or a model can write that becomes SQL — the plan's "never
 *    string-concatenates user input into SQL" is structural here, not a review rule.
 * 2. **Allowlisted per column, not per table.** A column the registry marks `is_queryable = false`
 *    (surrogate ids, `search_text`, `parent_chain`) cannot be selected, filtered or ordered on,
 *    and an unregistered table is refused outright.
 * 3. **Hard limits.** Row cap, column cap, filter cap and a request timeout, all enforced before
 *    the query is issued.
 *
 * What it deliberately does NOT do is aggregate. Every registered table is already an aggregate
 * (`agg_*`) or a dimension, so filter/order/project answers the questions these tables exist to
 * answer, and a generic GROUP BY would let the model re-derive a figure the pipeline already
 * computed — by a different definition, with no way to tell the two apart afterwards. `count` is
 * the one exception, because "how many rows match" cannot be misdefined.
 */

/** Row cap on any single query. A model that needs more than this is asking the wrong question. */
export const MAX_ROWS = 100;
export const DEFAULT_ROWS = 20;
/** Column cap — also the width of the default projection when the model names no columns. */
export const MAX_COLUMNS = 25;
export const MAX_FILTERS = 8;
export const MAX_IN_VALUES = 20;
export const QUERY_TIMEOUT_MS = 8000;

export const FILTER_OPS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "in",
  "is_null",
  "not_null",
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

/** Ops that take exactly one scalar; `in` takes a list; `is_null`/`not_null` take nothing. */
const SCALAR_OPS: readonly FilterOp[] = ["eq", "neq", "gt", "gte", "lt", "lte", "like"];
const NUMERIC_TYPES = ["smallint", "integer", "bigint", "numeric", "real", "double precision"];

const scalarSchema = z.union([z.string().max(200), z.number(), z.boolean()]);

export const queryArgsSchema = z.object({
  table: z.string().min(1).max(63),
  columns: z.array(z.string().min(1).max(63)).max(MAX_COLUMNS).optional(),
  filters: z
    .array(
      z.object({
        column: z.string().min(1).max(63),
        op: z.enum(FILTER_OPS),
        value: z.union([scalarSchema, z.array(scalarSchema).max(MAX_IN_VALUES)]).optional(),
      }),
    )
    .max(MAX_FILTERS)
    .optional(),
  orderBy: z.string().min(1).max(63).optional(),
  direction: z.enum(["asc", "desc"]).optional(),
  limit: z.number().int().min(1).max(MAX_ROWS).optional(),
  mode: z.enum(["rows", "count"]).optional(),
});

export type QueryArgs = z.infer<typeof queryArgsSchema>;
type ScalarValue = z.infer<typeof scalarSchema>;

export type QueryFilter = { column: string; op: FilterOp; value?: ScalarValue | ScalarValue[] };

export type QueryPlan = {
  table: string;
  columns: string[];
  filters: QueryFilter[];
  orderBy: string | null;
  direction: "asc" | "desc";
  limit: number;
  mode: "rows" | "count";
  /** Things true of the result that the model must say out loud, not silently absorb. */
  warnings: string[];
};

export type QueryError = { error: string };
export type PlanResult = { plan: QueryPlan } | QueryError;

function isError(result: PlanResult): result is QueryError {
  return "error" in result;
}

/** Column names, truncated — a refusal should teach the model the vocabulary, not flood the turn. */
function nameList(columns: RegisteredColumn[]): string {
  const names = columns.map((c) => c.name);
  if (names.length <= 20) return names.join(", ");
  return `${names.slice(0, 20).join(", ")}, … (${names.length} total)`;
}

function isNumericColumn(column: RegisteredColumn): boolean {
  return NUMERIC_TYPES.includes(column.dataType);
}

function checkValue(column: RegisteredColumn, op: FilterOp, value: ScalarValue): string | null {
  if (isNumericColumn(column) && typeof value !== "number") {
    // A numeric filter given as text is nearly always the model reading a label as a value
    // ("50%", "1st"). Refusing beats letting PostgREST coerce or 400 opaquely.
    return `Column ${column.name} is ${column.dataType}; filter it with a number, not ${JSON.stringify(value)}.`;
  }
  if (column.dataType === "boolean" && typeof value !== "boolean") {
    return `Column ${column.name} is boolean; filter it with true or false.`;
  }
  if (op === "like" && typeof value !== "string") {
    return `The like operator needs a text pattern, e.g. "%Cebu%".`;
  }
  // A closed vocabulary is the cheapest correctness check available: 'municipality' for a
  // geo_level of 'citymun' fails here with the real values rather than returning zero rows.
  if (column.allowedValues?.length && (op === "eq" || op === "neq" || op === "in")) {
    const asText = String(value);
    if (!column.allowedValues.includes(asText)) {
      return `Column ${column.name} only takes: ${column.allowedValues.join(", ")}. Got ${JSON.stringify(value)}.`;
    }
  }
  return null;
}

/**
 * Validates the model's arguments against one registered dataset and returns an executable plan,
 * or a refusal written for the model to act on. Pure — no database access — so every refusal path
 * is unit-testable without a live project.
 */
export function planQuery(dataset: RegisteredDataset, args: QueryArgs): PlanResult {
  const allowed = queryableColumns(dataset);
  const byName = new Map(allowed.map((c) => [c.name, c]));

  const resolve = (name: string, role: string): RegisteredColumn | QueryError => {
    const column = byName.get(name);
    if (column) return column;
    return {
      error: `Column ${name} is not available on ${dataset.tableName} (${role}). Queryable columns: ${nameList(allowed)}.`,
    };
  };

  const columns: string[] = [];
  for (const name of args.columns ?? []) {
    const column = resolve(name, "columns");
    if ("error" in column) return column;
    if (!columns.includes(column.name)) columns.push(column.name);
  }
  if (columns.length === 0) columns.push(...allowed.slice(0, MAX_COLUMNS).map((c) => c.name));

  const filters: QueryFilter[] = [];
  for (const filter of args.filters ?? []) {
    const column = resolve(filter.column, "filters");
    if ("error" in column) return column;

    if (filter.op === "is_null" || filter.op === "not_null") {
      filters.push({ column: column.name, op: filter.op });
      continue;
    }
    if (filter.value === undefined) {
      return { error: `Filter on ${column.name} with operator ${filter.op} needs a value.` };
    }
    if (filter.op === "in") {
      if (!Array.isArray(filter.value)) {
        return { error: `The in operator on ${column.name} needs a list of values.` };
      }
      if (filter.value.length === 0)
        return { error: `The in operator on ${column.name} needs at least one value.` };
      for (const value of filter.value) {
        const problem = checkValue(column, filter.op, value);
        if (problem) return { error: problem };
      }
      filters.push({ column: column.name, op: filter.op, value: filter.value });
      continue;
    }
    if (Array.isArray(filter.value)) {
      return { error: `Operator ${filter.op} on ${column.name} takes a single value, not a list.` };
    }
    if (SCALAR_OPS.includes(filter.op)) {
      const problem = checkValue(column, filter.op, filter.value);
      if (problem) return { error: problem };
    }
    filters.push({ column: column.name, op: filter.op, value: filter.value });
  }

  let orderBy: string | null = null;
  if (args.orderBy) {
    const column = resolve(args.orderBy, "orderBy");
    if ("error" in column) return column;
    orderBy = column.name;
  }

  const warnings: string[] = [];
  // Several tables hold more than one source dataset — two censuses in agg_population, three SAE
  // years in agg_poverty. Ordering or comparing across them silently mixes vintages, so an
  // unscoped query says so in its own payload rather than relying on the caveat being read.
  const datasetKey = byName.get("dataset_id");
  if (datasetKey && !filters.some((f) => f.column === "dataset_id")) {
    warnings.push(
      "No dataset_id filter: rows may span several source datasets or vintages. Scope the query before comparing or ranking.",
    );
  }
  if (dataset.notesMd) warnings.push(dataset.notesMd);

  return {
    plan: {
      table: dataset.tableName,
      columns,
      filters,
      orderBy,
      direction: args.direction ?? "desc",
      limit: args.limit ?? DEFAULT_ROWS,
      mode: args.mode ?? "rows",
      warnings,
    },
  };
}

export type QueryResult = {
  table: string;
  grain: string;
  mode: "rows" | "count";
  /** Rows returned (mode 'rows') — the sole basis for any number the model then states. */
  rows?: Record<string, unknown>[];
  matchingRows?: number;
  /** Unit per returned column, so a percent is never reported as a count. */
  units: Record<string, string>;
  filtersApplied: QueryFilter[];
  /** True when the row cap was reached — there may be more matches than are shown. */
  truncated?: boolean;
  warnings: string[];
};

async function runPlan(
  plan: QueryPlan,
  dataset: RegisteredDataset,
): Promise<QueryResult | QueryError> {
  // The generated `Database` type pins `.from()` to known table literals — correct for every
  // hand-written query in `lib/db`, and exactly what this tool cannot be. Here the allowlist is the
  // registry rather than the type system, which is why every identifier that reaches this function
  // has already been resolved against `dataset_column`. This cast is the one place that trade is
  // made, and it is deliberately confined to this function.
  const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
  const projection = plan.columns.join(", ");

  let query =
    plan.mode === "count"
      ? supabase.from(plan.table).select(projection, { count: "exact", head: true })
      : supabase.from(plan.table).select(projection);

  for (const filter of plan.filters) {
    switch (filter.op) {
      case "is_null":
        query = query.is(filter.column, null);
        break;
      case "not_null":
        query = query.not(filter.column, "is", null);
        break;
      case "in":
        query = query.in(filter.column, filter.value as ScalarValue[]);
        break;
      case "like":
        query = query.ilike(filter.column, filter.value as string);
        break;
      // Spelled out rather than indexed by operator name: a dynamic method lookup on the query
      // builder would take any string the type system happens to allow through.
      case "eq":
        query = query.eq(filter.column, filter.value as ScalarValue);
        break;
      case "neq":
        query = query.neq(filter.column, filter.value as ScalarValue);
        break;
      case "gt":
        query = query.gt(filter.column, filter.value as ScalarValue);
        break;
      case "gte":
        query = query.gte(filter.column, filter.value as ScalarValue);
        break;
      case "lt":
        query = query.lt(filter.column, filter.value as ScalarValue);
        break;
      case "lte":
        query = query.lte(filter.column, filter.value as ScalarValue);
        break;
    }
  }

  if (plan.mode === "rows") {
    if (plan.orderBy)
      query = query.order(plan.orderBy, { ascending: plan.direction === "asc", nullsFirst: false });
    query = query.limit(plan.limit);
  }

  const { data, error, count } = await query.abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));
  if (error) return { error: `Query on ${plan.table} failed: ${error.message}` };

  const units: Record<string, string> = {};
  for (const column of dataset.columns) {
    if (plan.columns.includes(column.name) && column.unit) units[column.name] = column.unit;
  }

  const base = {
    table: plan.table,
    grain: dataset.grain,
    units,
    filtersApplied: plan.filters,
    warnings: plan.warnings,
  };

  if (plan.mode === "count") return { ...base, mode: "count" as const, matchingRows: count ?? 0 };

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return {
    ...base,
    mode: "rows" as const,
    rows,
    truncated: rows.length === plan.limit,
  };
}

/**
 * The tool body: resolve the table in the registry, plan, execute. Returns a plain object on every
 * path — a refusal is data the model can react to, never a thrown error that kills the loop.
 */
export async function executeQueryDataset(
  rawArgs: Record<string, unknown>,
  exposure: Exposure,
  datasetSlugs?: readonly string[],
): Promise<QueryResult | QueryError> {
  const parsed = queryArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return {
      error: `Invalid arguments for queryDataset: ${parsed.error.issues[0]?.message ?? "unrecognized shape"}.`,
    };
  }

  // The dataset scope is resolved here, not only in `listDatasets`: a model that names a table it
  // was never shown must be refused by the tool that would read it, or the catalogue is a
  // suggestion rather than a boundary.
  const dataset = await getRegisteredDataset(parsed.data.table, exposure, datasetSlugs);
  if (!dataset) {
    return {
      error: `Table ${parsed.data.table} is not registered${exposure === "public" ? " for public use" : ""}${datasetSlugs ? " on this page" : ""}. Call listDatasets first — only registered tables can be queried.`,
    };
  }

  const planned = planQuery(dataset, parsed.data);
  if (isError(planned)) return planned;

  try {
    return await runPlan(planned.plan, dataset);
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    return {
      error: timedOut
        ? `Query on ${planned.plan.table} exceeded the ${QUERY_TIMEOUT_MS / 1000}s limit — narrow it with filters or a smaller limit.`
        : `Query on ${planned.plan.table} could not be completed.`,
    };
  }
}
