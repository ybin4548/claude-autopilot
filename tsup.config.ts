import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli.ts", "mcp-server": "src/mcp/server.ts" },
  format: ["esm"],
  target: "node20",
  clean: true,
});
