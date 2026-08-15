const { spawnSync } = require("node:child_process");

if (process.env.M11B_SEA_CHILD_PROBE === "1") {
  console.log(JSON.stringify({
    role: "embedded-main-reentered",
    execPath: process.execPath,
    argv: process.argv.slice(2),
  }));
  process.exit(0);
}

const childPath = process.env.M11B_SEA_CHILD_PATH || process.argv[2];
if (!childPath) {
  console.error("missing child path");
  process.exit(2);
}
const childNode = process.env.M11B_SEA_CHILD_NODE || process.execPath;
const result = spawnSync(childNode, [childPath], {
  encoding: "utf8",
  windowsHide: true,
  env: { ...process.env, M11B_SEA_CHILD_PROBE: "1" },
});
console.log(JSON.stringify({
  role: "sea-main",
  execPath: process.execPath,
  childCommand: childNode,
  childStatus: result.status,
  childSignal: result.signal,
  childStdout: String(result.stdout || "").trim(),
  childStderr: String(result.stderr || "").trim(),
}));
