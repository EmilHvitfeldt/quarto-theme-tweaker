import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** The extension host bundle (Node, CommonJS, vscode external). */
const hostConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  outfile: "dist/extension.js",
  external: ["vscode"],
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

/** The bridge client, bundled to a single IIFE injected into the preview page. */
const bridgeConfig = {
  entryPoints: ["src/webview/bridgeClient.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2019",
  outfile: "dist/bridgeClient.js",
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

if (watch) {
  const ctxs = await Promise.all([
    esbuild.context(hostConfig),
    esbuild.context(bridgeConfig),
  ]);
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log("[esbuild] watching...");
} else {
  await Promise.all([esbuild.build(hostConfig), esbuild.build(bridgeConfig)]);
}
