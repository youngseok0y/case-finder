import { prepareCodexHome } from "../src/codexAuthIsolation.js";

const codexHomePath = process.env.CODEX_HOME || "";

prepareCodexHome(codexHomePath, { source: process.env })
  .catch((error) => {
    console.error(JSON.stringify({
      code: error?.code || "CODEX_AUTH_HOME_UNAVAILABLE",
      message: error?.message || "dedicated Codex home could not be prepared",
    }));
    process.exitCode = 1;
  });
