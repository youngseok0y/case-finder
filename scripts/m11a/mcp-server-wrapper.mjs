import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const [entryPath, pidFile] = process.argv.slice(2);

if (!entryPath || !pidFile) {
  throw new Error("usage: mcp-server-wrapper.mjs <entryPath> <pidFile>");
}

await writeFile(pidFile, `${process.pid}\n`, "utf8");
await import(pathToFileURL(entryPath).href);
