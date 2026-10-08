import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  // the vendored KX parser imports Range/Position types from the LSP package;
  // the protocol types package provides the same runtime values without the server
  alias: { "vscode-languageserver": "vscode-languageserver-types" },
  external: ["vscode"],
  sourcemap: process.argv.includes("--sourcemap"),
  minify: process.argv.includes("--minify"),
  logLevel: "warning",
};

await Promise.all([
  build({ ...common, entryPoints: ["src/extension.ts"], outfile: "out/extension.js" }),
  build({ ...common, entryPoints: ["src/core.ts"], outfile: "out/core.js" }),
  build({ ...common, entryPoints: ["src/cli.ts"], outfile: "out/cli.js", banner: { js: "#!/usr/bin/env node" } }),
]);
