import { createLegalToolGateway } from "../legalToolGateway.js";

export function createRestrictedToolHandler({
  allowedTools,
  upstream,
  ledger,
  telemetry,
  safety,
  diagnostic = async () => {},
  createGateway = createLegalToolGateway,
} = {}) {
  return async ({ name, args = {} } = {}) => {
    if (!allowedTools.has(name)) throw new Error(`RESTRICTED_MCP_TOOL_DENIED:${name}`);

    let rawResult = null;
    const gateway = createGateway({
      ledger,
      telemetry,
      safety,
      callTool: async (toolName, toolArgs) => {
        rawResult = await upstream.callTool({ name: toolName, arguments: toolArgs });
        return rawResult;
      },
    });
    const result = await gateway.execute(name, args);
    await diagnostic({ event: "tool", name, trace: gateway.snapshotTrace().at(-1) || null });
    return rawResult || { isError: Boolean(result?.isError), content: [{ type: "text", text: JSON.stringify(result) }] };
  };
}
