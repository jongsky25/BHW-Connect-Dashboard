import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Stub out the `server-only` marker package — its real implementation throws unconditionally
  // outside of Next.js's build-time "react-server" resolution. Needed since Phase 2 (lib/ai/*)
  // unit-tests server-only modules directly (with DB/provider calls mocked at the module
  // boundary) rather than only pure logic.
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./vitest.server-only-stub.ts", import.meta.url)),
      // Mirror tsconfig's "@/*" path alias — value (non-type) imports like
      // `import { NATIONAL_GEO_CODE } from "@/lib/filters/schema"` survive to
      // runtime and need vitest to resolve them the way Next.js does.
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules", ".next", "ingestion/data"],
  },
});
