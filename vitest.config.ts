import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  // The shell tests render React components, which needs JSX compiled here:
  // tsconfig sets "jsx": "preserve" for Next.js, which the test transform
  // cannot parse, so it is compiled with the automatic runtime instead.
  oxc: {
    jsx: {
      runtime: "automatic",
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // services/scanner/archive holds the ClamAV engine and its tests. They are
    // parked, not deleted: ClamAV may return when it can be funded again. Until
    // then they are out of the suite so a test for an engine that is not wired
    // up cannot fail the build. See services/scanner/archive/clamav/README.md.
    exclude: ["**/node_modules/**", "**/.next/**", "services/scanner/archive/**"],
  },
})
