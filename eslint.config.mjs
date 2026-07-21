import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Filter state must be read/written through useFilterState, which applies
    // the same urlKeys mapping (compareGeos <-> ?geos=) as the server's
    // loadFilterState. A raw useQueryStates(filterParsers) call silently
    // desynchronizes client and server URLs — the bug that broke /compare.
    // lib/filters/use-filter-state.ts is the one sanctioned call site
    // (per-line eslint-disable there).
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "nuqs",
              importNames: ["useQueryState", "useQueryStates"],
              message:
                "Use useFilterState from @/lib/filters/use-filter-state — it applies the urlKeys mapping (?geos=) the server loader expects, plus shallow:false and history:'push'.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
