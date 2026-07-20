import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../vendor/analyzer-runtime.js", import.meta.url);
let src = readFileSync(path, "utf8");
const before = (src.match(/cdn\.jsdelivr\.net/g) || []).length;
src = src.replace(
  /https:\/\/cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers@\$\{[^}]+\}\/dist\//g,
  ""
);
src = src.replace(
  /https:\/\/cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers@[^"'`]+\/dist\//g,
  ""
);
const after = (src.match(/cdn\.jsdelivr\.net/g) || []).length;
writeFileSync(path, src);
console.log(JSON.stringify({ before, after, bytes: Buffer.byteLength(src) }));
