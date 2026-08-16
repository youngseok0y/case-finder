import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const LEVELS = Object.freeze({
  1: ["node_modules/@huggingface/transformers"],
  2: ["node_modules/@hyzyla/pdfium"],
  3: ["node_modules/onnxruntime-node"],
  4: ["node_modules/kordoc/node_modules/pdfjs-dist"],
  5: [
    "node_modules/sharp",
    "node_modules/@img/colour",
    "node_modules/@img/sharp-wasm32",
    "node_modules/@img/sharp-win32-x64",
  ],
});

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

async function main() {
  const stageRoot = path.resolve(argument("--stage"));
  const level = argument("--level", "all");
  const levels = level === "all"
    ? Object.keys(LEVELS).map(Number)
    : [Number(level)];
  if (!levels.every((value) => LEVELS[value])) throw new Error(`invalid --level: ${level}`);

  const nodeModulesRoot = path.resolve(stageRoot, "node_modules");
  const removed = [];
  for (const currentLevel of levels) {
    for (const relativePath of LEVELS[currentLevel]) {
      const target = path.resolve(stageRoot, relativePath);
      if (!target.startsWith(nodeModulesRoot + path.sep)) throw new Error(`target escaped node_modules: ${relativePath}`);
      try {
        await stat(target);
      } catch {
        throw new Error(`expected prune target is missing: ${relativePath}`);
      }
      await rm(target, { recursive: true, force: false });
      removed.push({ level: currentLevel, path: relativePath });
    }
  }

  console.log(JSON.stringify({ stageRoot, levels, removed }, null, 2));
}

await main();
