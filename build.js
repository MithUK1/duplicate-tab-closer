// Assembles an unpacked extension for each browser into dist/<browser>:
// everything in src/ plus that browser's manifest.
const fs = require("fs");
const path = require("path");

const root = __dirname;
const targets = ["chrome", "firefox"];

for (const target of targets) {
  const out = path.join(root, "dist", target);
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(path.join(root, "src"), out, { recursive: true });
  fs.copyFileSync(path.join(root, "manifests", `${target}.json`), path.join(out, "manifest.json"));
  console.log(`built dist/${target}`);
}
