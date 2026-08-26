export class AoV2SafetyError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "AoV2SafetyError";
    this.code = code;
  }
}

export class SafetyController {
  constructor({ wallClockMaxMs = 600_000, legalToolMax = 100, abortSignal = null, now = () => Date.now() } = {}) {
    this.wallClockMaxMs = wallClockMaxMs;
    this.legalToolMax = legalToolMax;
    this.abortSignal = abortSignal;
    this.now = now;
    this.startedAt = now();
    this.legalToolCalls = 0;
  }

  assertCanContinue() {
    if (this.abortSignal?.aborted) throw new AoV2SafetyError("ABORTED");
    if (this.now() - this.startedAt >= this.wallClockMaxMs) throw new AoV2SafetyError("WALL_CLOCK_MAX");
    if (this.legalToolCalls >= this.legalToolMax) throw new AoV2SafetyError("LEGAL_TOOL_MAX");
  }

  recordLegalToolCall() {
    if (this.legalToolCalls >= this.legalToolMax) throw new AoV2SafetyError("LEGAL_TOOL_MAX");
    this.legalToolCalls += 1;
  }
}

export function createSafetyController(options) {
  return new SafetyController(options);
}
