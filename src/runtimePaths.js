import path from "node:path";
import { text } from "./text.js";

export const MANAGED_NODE_RELATIVE_PATH = path.join("runtime", "node", "node.exe");

export function resolveRuntimePaths({ source = process.env, appRoot = process.cwd(), installRoot = "" } = {}) {
  const resolvedAppRoot = path.resolve(text(source?.CASE_FINDER_APP_ROOT) || appRoot);
  const resolvedInstallRoot = path.resolve(
    text(installRoot) || text(source?.CASE_FINDER_INSTALL_ROOT) || resolvedAppRoot,
  );
  const runtimeRoot = path.join(resolvedInstallRoot, "runtime");
  const statePath = path.join(resolvedInstallRoot, "state");

  return Object.freeze({
    installRoot: resolvedInstallRoot,
    appRoot: resolvedAppRoot,
    runtimeRoot,
    managedNodePath: path.join(resolvedInstallRoot, MANAGED_NODE_RELATIVE_PATH),
    codexHomePath: path.join(statePath, "codex-home"),
    codexWorkdir: path.join(statePath, "codex-runtime"),
    statePath,
    logsPath: path.join(resolvedInstallRoot, "logs"),
    envPath: path.join(resolvedInstallRoot, ".env"),
    serverPath: path.join(resolvedAppRoot, "src", "server.js"),
  });
}
