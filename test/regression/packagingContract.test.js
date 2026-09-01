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
    assert.match(source, /assets\\case-finder\.ico/iu);
  });

  test("Windows launcher icon is a valid multi-resolution ICO resource", async () => {
    const icon = await fs.readFile(path.join(ROOT, "assets", "case-finder.ico"));
    assert.equal(icon.readUInt16LE(0), 0);
    assert.equal(icon.readUInt16LE(2), 1);
    const count = icon.readUInt16LE(4);
    assert.equal(count, 7);

    const sizes = [];
    for (let index = 0; index < count; index += 1) {
      const entry = 6 + (index * 16);
      const size = icon[entry] || 256;
      const height = icon[entry + 1] || 256;
      const bytes = icon.readUInt32LE(entry + 8);
      const offset = icon.readUInt32LE(entry + 12);
      sizes.push(size);
      assert.equal(height, size);
      assert.equal(icon.readUInt16LE(entry + 4), 1);
      assert.equal(icon.readUInt16LE(entry + 6), 32);
      assert.ok(offset + bytes <= icon.length);
      assert.deepEqual([...icon.subarray(offset, offset + 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    }
    assert.deepEqual(sizes, [16, 24, 32, 48, 64, 128, 256]);
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
      "assets/case-finder.ico",
    ]) {
      assert.equal(included(resource), true, "runtime manifest is missing " + resource);
    }

    assert.doesNotMatch(JSON.stringify(manifest), /refine-plan\.txt/iu);
    assert.ok(manifest.exclude.includes("codex-login.bat"));
  });

  test("NSIS installer keeps the per-user payload and shortcut contracts", async () => {
    const source = await fs.readFile(path.join(ROOT, "packaging", "CaseFinder.nsi"), "utf8");
    assert.match(source, /Name "Case Finder"/u);
    assert.match(source, /InstallDir "\$LOCALAPPDATA\\CaseFinder"/u);
    assert.match(source, /RequestExecutionLevel user/u);
    assert.match(source, /assets\\case-finder\.ico/iu);
    assert.doesNotMatch(source, /ExecWait `/u);
    assert.match(source, /File "\$\{STAGING_ROOT\}\\assets\\case-finder\.ico"/u);
    assert.match(source, /CreateShortCut "\$DESKTOP\\Case Finder\.lnk" "\$INSTDIR\\start\.bat"/u);
    assert.match(source, /CreateShortCut "\$SMPROGRAMS\\Case Finder\\Case Finder\.lnk" "\$INSTDIR\\start\.bat"/u);
    assert.match(source, /Case Finder 제거\.lnk" "\$INSTDIR\\Uninstall\.exe"/u);
    assert.match(source, /SetOutPath "\$INSTDIR"/u);
    assert.match(source, /CurrentVersion\\Uninstall\\Case Finder/u);
    assert.doesNotMatch(source, /Program Files/iu);
    assert.doesNotMatch(source, /runtime\\codex/iu);
    assert.doesNotMatch(source, /codex-login\.bat/iu);
    assert.doesNotMatch(source, /Delete "\$INSTDIR\\\.env"/u);
    assert.doesNotMatch(source, /RMDir \/r "\$INSTDIR\\(?:state|logs)"/u);
  });

  test("staging builder copies only the approved external payload", async () => {
    const source = await fs.readFile(path.join(ROOT, "packaging", "build-staging.mjs"), "utf8");
    assert.match(source, /STAGING_ROOT_MUST_BE_EXTERNAL/u);
    assert.match(source, /path\.join\(sourceRoot, "assets", "case-finder\.ico"\)/u);
    assert.match(source, /path\.join\(sourceRoot, "runtime", "node", "node\.exe"\)/u);
    assert.match(source, /dependencies: "not installed/u);
    assert.doesNotMatch(source, /codex-login\.bat/iu);
  });

  test("staging verification is fail-closed for required and forbidden paths", async () => {
    const source = await fs.readFile(path.join(ROOT, "packaging", "verify-staging.mjs"), "utf8");
    assert.match(source, /STAGING_REQUIRED_PATH_MISSING/u);
    assert.match(source, /STAGING_FORBIDDEN_PATH_PRESENT/u);
    assert.match(source, /runtime-manifest\.json/u);
    assert.doesNotMatch(source, /codex-login\.bat/iu);
    assert.match(source, /path\.resolve\(stageRoot, normalized\)/u);
  });

  test("managed staging verification resolves runtime packages from the staging app", async () => {
    const source = await fs.readFile(path.join(ROOT, "src", "verifyManagedRuntime.js"), "utf8");
    assert.match(source, /createRequire/u);
    assert.match(source, /appRequire\.resolve/u);
    assert.match(source, /pathToFileURL\(appRequire\.resolve\(name\)\)/u);
    assert.match(source, /delete childEnv\.LAW_OC/u);
    assert.match(source, /delete childEnv\.GEMINI_API_KEY/u);
    assert.match(source, /CASE_FINDER_ENV_PATH: paths\.envPath/u);
    const builder = await fs.readFile(path.join(ROOT, "packaging", "build-installer.ps1"), "utf8");
    assert.match(builder, /verifyManagedRuntime\.js/u);
    assert.match(builder, /--skip-query/u);
    assert.match(builder, /Push-Location \$sourceRoot/u);
    assert.match(builder, /Pop-Location/u);
  });
})();
