import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function jsFiles(directory) {
  const root = path.join(ROOT, directory);
  const output = [];
  async function visit(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && file.endsWith(".js")) output.push(file);
    }
  }
  await visit(root);
  return output;
}

const files = [
  path.join(ROOT, "config.js"),
  ...(await jsFiles("src")),
  ...(await jsFiles("public")),
  ...(await jsFiles("packaging")),
  ...(await fs.readdir(path.join(ROOT, "test"))).filter((file) => file.endsWith(".test.js")).map((file) => path.join(ROOT, "test", file)),
];

for (const file of files.sort()) execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
console.log(`Checked ${files.length} JavaScript files.`);
