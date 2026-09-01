import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function normalize(relativePath) {
  return String(relativePath).replaceAll("\\", "/");
}

function isIncluded(relativePath, include) {
  return include.some((entry) => entry.directory
    ? relativePath === entry.path || relativePath.startsWith(`${entry.path}/`)
    : relativePath === entry.path);
}

function isExcluded(relativePath, pattern) {
  const normalized = normalize(pattern);
  if (normalized.endsWith("/")) {
    const directory = normalized.slice(0, -1);
    return relativePath === directory || relativePath.startsWith(`${directory}/`);
  }
  if (normalized.startsWith("*")) return relativePath.endsWith(normalized.slice(1));
  return relativePath === normalized;
}

function manifestPath(stageRoot, entry) {
  const normalized = normalize(entry);
  if (!normalized || path.posix.isAbsolute(normalized) || path.isAbsolute(entry) || normalized.includes("../") || normalized === "..") {
    fail("STAGING_MANIFEST_PATH_INVALID", normalized);
  }
  return path.resolve(stageRoot, normalized);
}

async function pathKind(filePath) {
  try {
    const details = await stat(filePath);
    return details.isDirectory() ? "directory" : details.isFile() ? "file" : "other";
  } catch {
    return "missing";
  }
}

async function walk(root, current = "") {
  const absolute = path.join(root, current);
  const entries = await readdir(absolute, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const relative = normalize(path.join(current, entry.name));
    paths.push(relative);
    if (entry.isDirectory()) paths.push(...await walk(root, relative));
  }
  return paths;
}

async function main() {
  const stageArgument = argument("--stage");
  if (!stageArgument) fail("STAGING_ROOT_REQUIRED", "missing required --stage");
  const stageRoot = path.resolve(stageArgument);
  const manifestPathArgument = argument("--manifest", path.join(ROOT, "packaging", "runtime-manifest.json"));
  const manifestPathValue = path.resolve(manifestPathArgument);
  const manifest = JSON.parse(await readFile(manifestPathValue, "utf8"));
  const include = (manifest.include || []).map((entry) => {
    const normalized = normalize(entry);
    return { path: normalized.endsWith("/") ? normalized.slice(0, -1) : normalized, directory: normalized.endsWith("/") };
  });

  const missing = [];
  for (const entry of include) {
    const actual = await pathKind(manifestPath(stageRoot, entry.path));
    if ((entry.directory && actual !== "directory") || (!entry.directory && actual !== "file")) {
      missing.push({ path: entry.path, expected: entry.directory ? "directory" : "file", actual });
    }
  }
  if (missing.length > 0) fail("STAGING_REQUIRED_PATH_MISSING", JSON.stringify(missing));

  const entries = await walk(stageRoot);
  const violations = [];
  for (const relativePath of entries) {
    for (const pattern of manifest.exclude || []) {
      if (isExcluded(relativePath, pattern) && !isIncluded(relativePath, include)) {
        violations.push({ path: relativePath, pattern });
      }
    }
  }
  if (violations.length > 0) fail("STAGING_FORBIDDEN_PATH_PRESENT", JSON.stringify(violations));

  console.log(JSON.stringify({
    status: "STAGING_MANIFEST_PASS",
    stageRoot,
    manifest: manifestPathValue,
    requiredPaths: include.length,
    scannedPaths: entries.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: "STAGING_MANIFEST_FAILED",
    code: error.code || "STAGING_MANIFEST_VERIFICATION_FAILED",
    message: error.message,
  }));
  process.exitCode = 1;
});
