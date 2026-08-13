import { LEGAL_TOOL_NAMES } from "../legalToolGateway.js";

export const RESTRICTED_LEGAL_TOOLS = Object.freeze([...LEGAL_TOOL_NAMES]);

export function createRestrictedLegalToolBridge(gateway) {
  return {
    tools: gateway.toolDefinitions(),
    allowedTools: [...RESTRICTED_LEGAL_TOOLS],
    call(name, args) {
      return gateway.execute(name, args);
    },
  };
}
