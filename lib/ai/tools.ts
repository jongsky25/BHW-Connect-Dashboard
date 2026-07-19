import "server-only";
import { z } from "zod";
import { getDataCompleteness as getDataCompletenessDb } from "@/lib/db/data-quality";
import { getGeoByCode } from "@/lib/db/geo";
import {
  getBhwCounts,
  getDemographics,
  getGeoSummary,
  getHonorarium,
  getTrainingCoverage as getTrainingCoverageDb,
} from "@/lib/db/indicators";
import { searchGeo as searchGeoDb } from "@/lib/db/search";
import { getBhwOverview } from "@/lib/db/stepzero";
import {
  DEMOGRAPHIC_DIMENSIONS,
  GEO_LEVELS,
  INDICATORS,
  NATIONAL_GEO_CODE,
  geoLevelSchema,
} from "@/lib/filters/schema";
import type { ToolDefinition } from "./providers/types";

export type Tool = {
  definition: ToolDefinition;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
};

const geoArgsSchema = z.object({ geoCode: z.string().min(1).max(20), geoLevel: geoLevelSchema });

/**
 * The fixed tool set the model may use to obtain numbers (BUILD_PLAN.md §4.5) — every tool is a
 * thin wrapper over the same `lib/db` functions the public pages call, so a number the model
 * reports and the number shown on screen are guaranteed to come from an identical query. Nothing
 * here reaches `fact_*`/raw rows; only the public `agg_*`/`dim_*` layer. Every `execute` returns a
 * plain object (never throws) so a malformed or adversarial tool argument surfaces to the model as
 * data it can react to, rather than crashing the tool-calling loop.
 */
export const TOOLS: Tool[] = [
  {
    definition: {
      name: "listAvailableIndicators",
      description:
        "List every indicator and demographic breakdown dimension available in the BHW dataset, for any geography.",
      parameters: { type: "object", properties: {} },
    },
    async execute() {
      return { indicators: INDICATORS, demographicDimensions: DEMOGRAPHIC_DIMENSIONS };
    },
  },
  {
    definition: {
      name: "getIndicatorByGeo",
      description:
        "Get one indicator's figures for a single geography, identified by its exact geo_code (use searchGeo first if you only have a place name). Every response includes Total BHWs (the full DOH StepZero universe) alongside Validated profiles (the individually-profiled subset) — always describe these as two distinct counts, never as the same number.",
      parameters: {
        type: "object",
        properties: {
          geoCode: { type: "string", description: "Exact geo_code — 'PH' for national, or a PSGC code." },
          geoLevel: { type: "string", enum: [...GEO_LEVELS] },
          indicator: { type: "string", enum: [...INDICATORS] },
        },
        required: ["geoCode", "geoLevel", "indicator"],
      },
    },
    async execute(args) {
      const parsed = geoArgsSchema.extend({ indicator: z.enum(INDICATORS) }).safeParse(args);
      if (!parsed.success) return { error: "Invalid arguments for getIndicatorByGeo." };
      const { geoCode, geoLevel, indicator } = parsed.data;

      const [summary, overview] = await Promise.all([getGeoSummary(geoCode), getBhwOverview(geoCode, geoLevel)]);
      if (!summary) return { error: `No data found for geo_code ${geoCode} at level ${geoLevel}.` };

      const base = {
        geoCode,
        geoLevel,
        geoName: summary.geoName,
        totalBhw: overview.totalBhw,
        validatedProfiles: overview.validatedProfiles,
        profilingCoveragePct: overview.profilingCoveragePct,
        population: overview.population,
        bhwPer1000Residents: overview.bhwPer1000Residents,
      };

      if (indicator === "accreditation" || indicator === "service_years") {
        return { ...base, counts: await getBhwCounts(geoCode, geoLevel) };
      }
      if (indicator === "demographics") {
        return { ...base, demographics: await getDemographics(geoCode, geoLevel, [...DEMOGRAPHIC_DIMENSIONS]) };
      }
      if (indicator === "training") {
        return { ...base, training: await getTrainingCoverageDb(geoCode, geoLevel) };
      }
      return { ...base, honorarium: await getHonorarium(geoCode, geoLevel) };
    },
  },
  {
    definition: {
      name: "compareGeos",
      description: "Compare one indicator across 2-4 geographies of the same geo level.",
      parameters: {
        type: "object",
        properties: {
          geoCodes: { type: "array", items: { type: "string" }, description: "2 to 4 exact geo_codes." },
          geoLevel: { type: "string", enum: [...GEO_LEVELS] },
          indicator: { type: "string", enum: [...INDICATORS] },
        },
        required: ["geoCodes", "geoLevel", "indicator"],
      },
    },
    async execute(args) {
      const parsed = z
        .object({ geoCodes: z.array(z.string().min(1).max(20)).min(2).max(4), geoLevel: geoLevelSchema, indicator: z.enum(INDICATORS) })
        .safeParse(args);
      if (!parsed.success) return { error: "Invalid arguments for compareGeos — provide 2 to 4 geo_codes at the same level." };
      const { geoCodes, geoLevel, indicator } = parsed.data;

      const getIndicatorByGeo = TOOLS.find((t) => t.definition.name === "getIndicatorByGeo")!;
      const results = await Promise.all(geoCodes.map((geoCode) => getIndicatorByGeo.execute({ geoCode, geoLevel, indicator })));
      return { geoLevel, indicator, results };
    },
  },
  {
    definition: {
      name: "getTrainingCoverage",
      description: "Training-topic coverage for one geography (not available at barangay level — falls back to its city/municipality).",
      parameters: {
        type: "object",
        properties: { geoCode: { type: "string" }, geoLevel: { type: "string", enum: [...GEO_LEVELS] } },
        required: ["geoCode", "geoLevel"],
      },
    },
    async execute(args) {
      const parsed = geoArgsSchema.safeParse(args);
      if (!parsed.success) return { error: "Invalid arguments for getTrainingCoverage." };
      const rows = await getTrainingCoverageDb(parsed.data.geoCode, parsed.data.geoLevel);
      if (rows.length === 0 && parsed.data.geoLevel === "barangay") {
        return { note: "Training coverage isn't tracked at the barangay level.", rows: [] };
      }
      return { rows };
    },
  },
  {
    definition: {
      name: "getHonorariumStats",
      description: "Honorarium (cash allowance) receipt for one geography, broken down by which administrative level pays it.",
      parameters: {
        type: "object",
        properties: { geoCode: { type: "string" }, geoLevel: { type: "string", enum: [...GEO_LEVELS] } },
        required: ["geoCode", "geoLevel"],
      },
    },
    async execute(args) {
      const parsed = geoArgsSchema.safeParse(args);
      if (!parsed.success) return { error: "Invalid arguments for getHonorariumStats." };
      return { rows: await getHonorarium(parsed.data.geoCode, parsed.data.geoLevel) };
    },
  },
  {
    definition: {
      name: "getDataCompleteness",
      description: "National field-level missingness in the source dataset — which fields have gaps and how large they are.",
      parameters: { type: "object", properties: {} },
    },
    async execute() {
      return { rows: await getDataCompletenessDb() };
    },
  },
  {
    definition: {
      name: "searchGeo",
      description: "Look up a place by name (region, province, city/municipality, or barangay — exact or approximate spelling) to get its exact geo_code and geo_level.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Place name, e.g. 'Quezon City' or 'CALABARZON'." } },
        required: ["query"],
      },
    },
    async execute(args) {
      const parsed = z.object({ query: z.string().min(1).max(200) }).safeParse(args);
      if (!parsed.success) return { error: "Invalid arguments for searchGeo." };
      const results = await searchGeoDb(parsed.data.query);
      return { results };
    },
  },
];

export const TOOL_DEFINITIONS: ToolDefinition[] = TOOLS.map((tool) => tool.definition);

/** Runs a model-issued tool call by name, returning a JSON-serializable payload or an error object. */
export async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = TOOLS.find((t) => t.definition.name === name);
  if (!tool) return { error: `Unknown tool: ${name}` };
  try {
    return await tool.execute(args);
  } catch {
    return { error: `Tool ${name} failed.` };
  }
}

/** Confirms a geo_code exists before it's used to seed a narrative/chat context — 404s cleanly rather than letting a stale/hand-typed code reach the model as if it were valid. */
export async function isKnownGeo(geoCode: string): Promise<boolean> {
  if (geoCode === NATIONAL_GEO_CODE) return true;
  return (await getGeoByCode(geoCode)) !== null;
}
