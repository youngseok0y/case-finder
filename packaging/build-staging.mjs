import { access, cp, mkdir, readdir } from "node:fs/promises";
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

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isWithin(candidate, parent) {
  const normalizedCandidate = path.resolve(candidate).toLowerCase();
  const normalizedParent = path.resolve(parent).toLowerCase();
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}${path.sep}`);
}

async function requiredFile(filePath, label) {
  if (!await exists(filePath)) fail("STAGING_SOURCE_MISSING", `${label}:${filePath}`);
}

async function copyFile(source, destination, label) {
  await requiredFile(source, label);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { force: false, errorOnExist: true });
}

async function copyDirectory(source, destination, label) {
  await requiredFile(source, label);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: false, errorOnExist: true });
}

async function main() {
  const stageArgument = argument("--stage");
  if (!stageArgument) fail("STAGING_ROOT_REQUIRED", "missing required --stage");

  const sourceRoot = path.resolve(argument("--source", ROOT));
  const stageRoot = path.resolve(stageArgument);
  if (isWithin(stageRoot, sourceRoot) || isWithin(sourceRoot, stageRoot)) {
    fail("STAGING_ROOT_MUST_BE_EXTERNAL", "staging root must not contain or be contained by the source checkout");
  }

  if (await exists(stageRoot)) {
    const entries = await readdir(stageRoot);
    if (entries.length > 0) fail("STAGING_ROOT_NOT_EMPTY", stageRoot);
  } else {
    await mkdir(stageRoot, { recursive: true });
  }

  const appRoot = path.join(stageRoot, "app");
  await copyDirectory(path.join(sourceRoot, "src"), path.join(appRoot, "src"), "src");
  await copyDirectory(path.join(sourceRoot, "public"), path.join(appRoot, "public"), "public");
  for (const file of ["config.js", "package.json", "package-lock.json"]) {
    await copyFile(path.join(sourceRoot, file), path.join(appRoot, file), file);
  }
  for (const file of ["plan.txt", "select.txt"]) {
    await copyFile(path.join(sourceRoot, "prompts", file), path.join(appRoot, "prompts", file), `prompt:${file}`);
  }

  await copyFile(
    path.join(sourceRoot, "runtime", "node", "node.exe"),
    path.join(stageRoot, "runtime", "node", "node.exe"),
    "managed node",
  );
  await copyFile(
    path.join(sourceRoot, "assets", "case-finder.ico"),
    path.join(stageRoot, "assets", "case-finder.ico"),
    "product icon",
  );
  await copyFile(path.join(sourceRoot, ".env.example"), path.join(stageRoot, ".env.example"), ".env.example");
  await copyFile(path.join(sourceRoot, "start.bat"), path.join(stageRoot, "start.bat"), "start.bat");

  console.log(JSON.stringify({
    status: "STAGING_PAYLOAD_READY",
    sourceRoot,
    stageRoot,
    immutable: [
      "app/src/",
      "app/public/",
      "app/prompts/",
      "app/config.js",
      "app/package.json",
      "app/package-lock.json",
      "runtime/node/node.exe",
      "assets/case-finder.ico",
      ".env.example",
      "start.bat",
    ],
    dependencies: "not installed; run npm ci --omit=dev from stageRoot/app",
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: "STAGING_PAYLOAD_FAILED",
    code: error.code || "STAGING_BUILD_FAILED",
    message: error.message,
  }));
  process.exitCode = 1;
});
