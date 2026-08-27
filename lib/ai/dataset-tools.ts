import "server-only";
import {
  describeDataset,
  listRegisteredDatasets,
  getRegisteredDataset,
  type Exposure,
} from "@/lib/db/dataset-registry";
import {
  executeQueryDataset,
  FILTER_OPS,
  MAX_COLUMNS,
  MAX_ROWS,
  DEFAULT_ROWS,
} from "./query-dataset";
import { TOOLS, type Tool } from "./tools";
import { createSearchDocumentsTool } from "./search-documents";
import { createTraversalTool } from "./traverse-graph";

/**
 * The registry-driven half of the tool set (docs/AI_ASSISTANT_PLAN.md §8, Increment 1.3): a
 * discovery tool and a query tool, both reading `dataset_registry` at call time.
 *
 * Discovery is not optional decoration. The registry is what the model is *shown*, and it cannot
 * write a correct query against a table it has never seen described — so `listDatasets` (names and
 * grains, or one full data dictionary) is what makes `queryDataset` usable at all. The plan counts
 * them as one increment for that reason.
 *
 * Both are built per `exposure`, so the same code serves a public surface (the `agg_*`/`dim_*`
 * layer anon can already read) and the internal assistant (`fact_*` too) without a second
 * allowlist and without either one being able to reach past its own boundary.
 */
export function createDatasetTools(exposure: Exposure): Tool[] {
  return [
    {
      definition: {
        name: "listDatasets",
        description:
          "List every dataset table you may query, with what one row of each means. Call with no arguments for the catalogue; call with a table name for that table's full data dictionary — every column, its meaning, its unit, its allowed values, and the caveats that change how its figures must be described. Always read a table's dictionary before querying it.",
        parameters: {
          type: "object",
          properties: {
            table: {
              type: "string",
              description: "Optional: a table name from the catalogue, to get its full dictionary.",
            },
          },
        },
      },
      async execute(args) {
        const table = typeof args.table === "string" ? args.table : null;

        if (table) {
          const dataset = await getRegisteredDataset(table, exposure);
          if (!dataset) {
            const available = await listRegisteredDatasets(exposure);
            return {
              error: `Table ${table} is not registered. Available: ${available.map((d) => d.tableName).join(", ")}.`,
            };
          }
          return { table: dataset.tableName, dictionary: describeDataset(dataset) };
        }

        const datasets = await listRegisteredDatasets(exposure);
        if (datasets.length === 0) {
          return {
            error: "The dataset registry is unavailable — use the indicator tools instead.",
            datasets: [],
          };
        }
        return {
          datasets: datasets.map((d) => ({
            table: d.tableName,
            title: d.title,
            summary: d.summary,
            grain: d.grain,
            approxRows: d.rowEstimate,
          })),
        };
      },
    },
    {
      definition: {
        name: "queryDataset",
        description:
          "Read rows from one registered dataset table, or count the rows that match. Filter, order and project only — this tool never aggregates, because every registered table is already an aggregate: take the figure the pipeline computed rather than re-deriving one. Only columns the dictionary lists are available; call listDatasets for the table's dictionary first. Numbers you state must come from a column the dictionary marks as a measure, in the unit it names.",
        parameters: {
          type: "object",
          properties: {
            table: { type: "string", description: "Table name from listDatasets." },
            columns: {
              type: "array",
              items: { type: "string" },
              description: `Columns to return. Defaults to the first ${MAX_COLUMNS} queryable columns.`,
            },
            filters: {
              type: "array",
              description: "Filters, ANDed together.",
              items: {
                type: "object",
                properties: {
                  column: { type: "string" },
                  op: { type: "string", enum: [...FILTER_OPS] },
                  value: {
                    description:
                      "Value for the operator: a single value, a list for in, omitted for is_null/not_null.",
                  },
                },
                required: ["column", "op"],
              },
            },
            orderBy: { type: "string", description: "Column to sort by." },
            direction: { type: "string", enum: ["asc", "desc"] },
            limit: {
              type: "number",
              description: `Rows to return, 1-${MAX_ROWS} (default ${DEFAULT_ROWS}).`,
            },
            mode: {
              type: "string",
              enum: ["rows", "count"],
              description: "rows returns the matching rows; count returns only how many match.",
            },
          },
          required: ["table"],
        },
      },
      async execute(args) {
        return executeQueryDataset(args, exposure);
      },
    },
  ];
}

/**
 * The internal assistant's tool set (Increment 1.4): the public indicator tools plus the
 * registry-driven pair at `internal` exposure.
 *
 * `traverseGraph` (Increment 1.6) and `searchDocuments` (2.2) are internal-only for the same
 * reason `queryDataset` is: they read `kb_edge` and `doc_chunk`, which are service-role only —
 * and the document corpus is internal budget material besides (§12.5). A tool the model never
 * selects has not shipped, so each is registered here and described in the internal system prompt
 * in the increment that builds it.
 *
 * With `searchDocuments` the set now spans all three retrieval paths in §2: SQL for numbers,
 * edges for provenance, documents for prose. The model chooses; the loop is unchanged.
 *
 * The hand-written tools are kept rather than replaced. `searchGeo` resolves a place name to a
 * geo_code in one call — the registry path would need a `like` scan of `dim_geo` and still guess
 * between namesakes — and the indicator tools return the same shaped figures the dashboard shows,
 * which is what makes "the number in the answer matches the number on screen" true for internal
 * users too. `queryDataset` covers everything they do not.
 */
export function createInternalTools(): Tool[] {
  return [
    ...TOOLS,
    ...createDatasetTools("internal"),
    createTraversalTool(),
    createSearchDocumentsTool(),
  ];
}
