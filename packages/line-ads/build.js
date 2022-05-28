const { build } = require("esbuild");

build({
  bundle: true,
  minify: true,
  treeShaking: true,
  sourcemap: false,
  entryPoints: ["./index.ts"],
  outfile: "./build/index.js",
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
