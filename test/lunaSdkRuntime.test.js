import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildCodexSdkEnv,
  createCodexSdkClient,
  createCodexSdkSessionFactory,
  inspectPackagedCodexRuntime,
} from "../src/lunaSdkRuntime.js";

const finalResponse = JSON.stringify({
  selected: [{ case_no: "2020다1234", match: "direct" }],
  intro: "설명",
});

class FakeThread {
  constructor(events) {
    this.events = events;
    this.id = null;
  }

  async runStreamed() {
    const events = this.events;
    return {
      events: (async function* stream() {
        for (const event of events) yield event;
      }()),
    };
  }
}

class FakeCodex {
  static options;
  static threadOptions;
  static events = [
    { type: "thread.started", thread_id: "sdk-thread-1" },
    {
      type: "item.started",
      item: {
        id: "tool-1",
        type: "mcp_tool_call",
        server: "korean_law",
        tool: "search_decisions",
        arguments: { domain: "precedent", query: "계약" },
        status: "in_progress",
      },
    },
    {
      type: "item.completed",
      item: {
        id: "tool-1",
        type: "mcp_tool_call",
        server: "korean_law",
        tool: "search_decisions",
        arguments: { domain: "precedent", query: "계약" },
        result: { content: [{ type: "text", text: "search result" }] },
        status: "completed",
      },
    },
    {
      type: "item.completed",
      item: { id: "message-1", type: "agent_message", text: finalResponse },
    },
    {
      type: "turn.completed",
      usage: {
        input_tokens: 10,
        cached_input_tokens: 2,
        cache_write_input_tokens: 0,
        output_tokens: 5,
        reasoning_output_tokens: 3,
      },
    },
  ];

  constructor(options) {
    FakeCodex.options = options;
  }

  startThread(options) {
    FakeCodex.threadOptions = options;
    return new FakeThread(FakeCodex.events);
  }
}

test("SDK session translates restricted MCP events and keeps the canonical final result", async () => {
  const delegated = [];
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "case-finder-sdk-test-"));
  const factory = createCodexSdkSessionFactory({
    baseDir: testRoot,
    CodexClass: FakeCodex,
    source: {
      PATH: "C:\\Windows\\System32",
      USERPROFILE: "C:\\Users\\tester",
      LAW_OC: "secret-law-key",
      GEMINI_API_KEY: "secret-gemini-key",
    },
    proxyPath: "C:\\case-finder\\restricted-mcp.js",
  });
  try {
    const session = await factory({
      prompt: "질문",
      model: "gpt-5.6-luna",
      reasoningEffort: "medium",
      onDelegatedToolResult: (value) => delegated.push(value),
    });

    const toolCall = await session.next();
    const final = await session.next();

    assert.equal(toolCall.type, "mcp_tool_call");
    assert.equal(toolCall.delegated, true);
    assert.equal(toolCall.name, "search_decisions");
    assert.equal(final.type, "final");
    assert.deepEqual(final.selection, JSON.parse(finalResponse));
    assert.equal(final.session_id, "sdk-thread-1");
    assert.equal(delegated.length, 1);
    assert.equal(delegated[0].name, "search_decisions");
    assert.equal(delegated[0].result.content[0].text, "search result");

    assert.equal(FakeCodex.threadOptions.model, "gpt-5.6-luna");
    assert.equal(FakeCodex.threadOptions.modelReasoningEffort, "medium");
    assert.equal(FakeCodex.threadOptions.sandboxMode, "read-only");
    assert.equal(FakeCodex.threadOptions.webSearchMode, "disabled");
    assert.equal(FakeCodex.options.env.LAW_OC, undefined);
    assert.equal(FakeCodex.options.env.GEMINI_API_KEY, undefined);
    assert.equal(FakeCodex.options.env.CODEX_CLI_PATH, undefined);
    assert.equal(FakeCodex.options.env.CODEX_HOME, "C:\\Users\\tester\\.codex");
    assert.equal(FakeCodex.options.codexPathOverride, undefined);
    assert.equal(FakeCodex.options.config.mcp_servers.korean_law.command, process.execPath);
    assert.deepEqual(FakeCodex.options.config.mcp_servers.korean_law.args, ["C:\\case-finder\\restricted-mcp.js"]);

    await session.close();
  } finally {
    await fs.rm(testRoot, { recursive: true, force: true });
  }
});

test("SDK runtime environment preserves user auth source without Case Finder secrets", () => {
  const env = buildCodexSdkEnv({
    PATH: "C:\\Windows\\System32",
    USERPROFILE: "C:\\Users\\tester",
    CODEX_HOME: "C:\\Users\\tester\\.codex",
    LAW_OC: "secret-law-key",
    GEMINI_API_KEY: "secret-gemini-key",
  });
  assert.equal(env.CODEX_HOME, "C:\\Users\\tester\\.codex");
  assert.equal(env.USERPROFILE, "C:\\Users\\tester");
  assert.equal(env.HOME, "C:\\Users\\tester");
  assert.equal(env.LAW_OC, undefined);
  assert.equal(env.GEMINI_API_KEY, undefined);
});

test("SDK constructor failure is classified as runtime unavailable", () => {
  assert.throws(
    () => createCodexSdkClient({
      CodexClass: class BrokenCodex {
        constructor() { throw new Error("packaged runtime missing"); }
      },
      source: {},
    }),
    (error) => error.code === "CODEX_SDK_RUNTIME_UNAVAILABLE",
  );
});

test("SDK packaged-runtime preflight probes the SDK client and thread without a model turn", async () => {
  let constructed = false;
  let started = false;
  class ProbeCodex {
    constructor(options) {
      constructed = Boolean(options?.config?.mcp_servers?.korean_law);
    }

    startThread(options) {
      started = options?.model === "gpt-5.6-luna"
        && options?.modelReasoningEffort === "medium"
        && options?.sandboxMode === "read-only";
      return { runStreamed() {} };
    }
  }
  const runtime = await inspectPackagedCodexRuntime({
    platform: "win32",
    arch: "x64",
    CodexClass: ProbeCodex,
    source: { USERPROFILE: "C:\\Users\\tester" },
    resolvePackage: async () => "file:///C:/pkg/package.json",
    fsImpl: { stat: async () => ({}) },
  });
  assert.equal(constructed, true);
  assert.equal(started, true);
  assert.equal(runtime.sdkClient, true);
  assert.equal(runtime.sdkThread, true);
});

test("SDK execution failure is classified without exposing the raw SDK error", async () => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "case-finder-sdk-failure-"));
  class FailingThread {
    async runStreamed() {
      throw new Error("private SDK stderr detail");
    }
  }
  class FailingCodex {
    startThread() { return new FailingThread(); }
  }
  const factory = createCodexSdkSessionFactory({
    baseDir: testRoot,
    CodexClass: FailingCodex,
    source: { USERPROFILE: "C:\\Users\\tester" },
  });
  try {
    const session = await factory({ prompt: "query" });
    await assert.rejects(
      session.next(),
      (error) => error.code === "CODEX_SDK_EXECUTION_FAILED"
        && !error.message.includes("private SDK stderr"),
    );
  } finally {
    await fs.rm(testRoot, { recursive: true, force: true });
  }
});

test("SDK session timeout aborts the turn without producing a final", async () => {
  let aborted = false;
  class TimeoutThread {
    async runStreamed(_prompt, { signal }) {
      return {
        events: (async function* events() {
          await new Promise((resolve, reject) => {
            signal.addEventListener("abort", () => {
              aborted = true;
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            }, { once: true });
          });
        }()),
      };
    }
  }
  class TimeoutCodex {
    startThread() { return new TimeoutThread(); }
  }
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "case-finder-sdk-timeout-"));
  const factory = createCodexSdkSessionFactory({
    baseDir: testRoot,
    CodexClass: TimeoutCodex,
    source: { USERPROFILE: "C:\\Users\\tester" },
    sessionTimeoutMs: 20,
  });
  try {
    const session = await factory({ prompt: "query" });
    await assert.rejects(session.next(), (error) => error.code === "CODEX_NATIVE_SESSION_TIMEOUT");
    assert.equal(aborted, true);
    assert.equal(session.finalQueued, false);
    await session.close();
  } finally {
    await fs.rm(testRoot, { recursive: true, force: true });
  }
});

test("SDK session close aborts an active stream and resolves without false success", async () => {
  let aborted = false;
  class CloseThread {
    async runStreamed(_prompt, { signal }) {
      return {
        events: (async function* events() {
          await new Promise((resolve, reject) => {
            signal.addEventListener("abort", () => {
              aborted = true;
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            }, { once: true });
          });
        }()),
      };
    }
  }
  class CloseCodex {
    startThread() { return new CloseThread(); }
  }
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "case-finder-sdk-close-"));
  const factory = createCodexSdkSessionFactory({
    baseDir: testRoot,
    CodexClass: CloseCodex,
    source: { USERPROFILE: "C:\\Users\\tester" },
    sessionTimeoutMs: 1_000,
  });
  try {
    const session = await factory({ prompt: "query" });
    const pending = session.next();
    await new Promise((resolve) => setImmediate(resolve));
    await session.close();
    assert.equal(await pending, null);
    assert.equal(aborted, true);
    assert.equal(session.finalQueued, false);
  } finally {
    await fs.rm(testRoot, { recursive: true, force: true });
  }
});
