import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("development Codex login helper uses local Node and checkout dependencies", async () => {
  const source = await fs.readFile(path.join(ROOT, "codex-login.bat"), "utf8");

  assert.match(source, /set "NODE_EXE=node\.exe"/iu);
  assert.match(source, /node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex\.exe/iu);
  assert.doesNotMatch(source, /app\\node_modules|runtime\\node\\node\.exe/iu);
  assert.match(source, /set "CODEX_HOME=%CASEFINDER_ROOT%state\\codex-home"/iu);
  assert.match(source, /scripts\\prepare-codex-home\.mjs/iu);
  assert.doesNotMatch(source, /if not defined CODEX_HOME|%USERPROFILE%\\\.codex/iu);
  assert.match(source, /login status/iu);
  assert.match(source, /logout/iu);
  assert.match(source, /"%CODEX_EXE%" login/iu);
});
