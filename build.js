// Assembles an unpacked extension for each browser into extension/<browser>:
// everything in extension/src/ plus that browser's manifest.
const fs = require("fs");
const path = require("path");

const root = __dirname;
const targets = ["chrome", "firefox"];

for (const target of targets) {
  const out = path.join(root, "extension", target);
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(path.join(root, "extension", "src"), out, { recursive: true });
  fs.copyFileSync(path.join(root, "extension", "manifests", `${target}.json`), path.join(out, "manifest.json"));
  console.log(`built extension/${target}`);
}
