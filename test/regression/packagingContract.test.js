// Consolidated from test/codexLogin.test.js.
await (async () => {
  const assert = (await import("node:assert/strict")).default;
  const fs = (await import("node:fs/promises")).default;
  const path = (await import("node:path")).default;
  const test = (await import("node:test")).default;
  const { fileURLToPath } = await import("node:url");
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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
    assert.match(source, /setlocal EnableExtensions DisableDelayedExpansion/iu);
    assert.doesNotMatch(source, /EnableDelayedExpansion/iu);
  });

  test("Windows launcher avoids delayed path expansion and stale PID block values", async () => {
    const source = await fs.readFile(path.join(ROOT, "start.bat"), "utf8");

    assert.match(source, /setlocal EnableExtensions DisableDelayedExpansion/iu);
    assert.doesNotMatch(source, /EnableDelayedExpansion/iu);
    assert.doesNotMatch(source, /![A-Z_]+!/u);
    assert.match(source, /Tracked server PID/iu);
    assert.match(source, /Current port owner is PID %PORT_PID%/iu);
    assert.match(source, /Get-CimInstance Win32_Process/iu);
    assert.match(source, /Join-Path \$env:APP_ROOT 'src\\server\.js'/iu);
    assert.match(source, /PORT must contain only digits/iu);
    assert.match(source, /%%~B/iu);
  });

  test("runtime manifest includes every live prompt and public resource read", async () => {
    const manifest = JSON.parse(await fs.readFile(path.join(ROOT, "packaging", "runtime-manifest.json"), "utf8"));
    const include = manifest.include.map((entry) => entry.replaceAll("\\", "/"));
    const included = (resource) => include.some((entry) => (
      entry.endsWith("/") ? resource.startsWith(entry) : resource === entry
    ));

    const geminiSource = await fs.readFile(path.join(ROOT, "src", "gemini.js"), "utf8");
    assert.ok(geminiSource.includes('path.join(ROOT_DIR, "prompts", "plan.txt")'));
    assert.ok(geminiSource.includes('path.join(ROOT_DIR, "prompts", "select.txt")'));

    for (const resource of [
      "app/prompts/plan.txt",
      "app/prompts/select.txt",
      "app/public/index.html",
      "app/public/styles.css",
      "app/public/app.js",
      "app/public/admin.html",
      "app/public/admin.js",
      "app/src/server.js",
      "app/config.js",
      "app/package.json",
      "app/package-lock.json",
      "runtime/node/node.exe",
      "start.bat",
    ]) {
      assert.equal(included(resource), true, "runtime manifest is missing " + resource);
    }

    assert.doesNotMatch(JSON.stringify(manifest), /refine-plan\.txt/iu);
  });
})();
