export class AoV2SafetyError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "AoV2SafetyError";
    this.code = code;
  }
}

export class SafetyController {
  constructor({ wallClockMaxMs = 600_000, legalToolMax = 100, noProgressMax = 3, abortSignal = null, now = () => Date.now() } = {}) {
    this.wallClockMaxMs = wallClockMaxMs;
    this.legalToolMax = legalToolMax;
    this.noProgressMax = noProgressMax;
    this.abortSignal = abortSignal;
    this.now = now;
    this.startedAt = now();
    this.legalToolCalls = 0;
    this.noProgressTurns = 0;
    this.lastEvidenceCount = 0;
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

  noteEvidenceCount(count) {
    if (count > this.lastEvidenceCount) this.noProgressTurns = 0;
    else this.noProgressTurns += 1;
    this.lastEvidenceCount = count;
  }

  shouldStopForNoProgress() {
    return this.noProgressTurns >= this.noProgressMax;
  }
}

export function createSafetyController(options) {
  return new SafetyController(options);
}
