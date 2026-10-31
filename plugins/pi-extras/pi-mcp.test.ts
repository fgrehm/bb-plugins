import { strict as assert } from "node:assert";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readMcpServers, mcpConfigPath } from "./pi-mcp.ts";
import { readSettings, writeSettings, unsetPiSettings } from "./pi-settings.ts";
import { applyToolToggle, toolsState } from "./pi-tools.ts";
import { normalizeAgentDirValue } from "./pi-trust.ts";

test("tool toggles keep absence and explicit emptiness distinct", () => {
  // Unchecking the last tool of an explicit selection pi reads as []: no tools.
  assert.deepEqual(applyToolToggle(["read"], "read", false), []);
  // An absent key toggling an already-active default is a no-op: absence returns.
  assert.equal(applyToolToggle(null, "bash", true), null);
  assert.equal(applyToolToggle(["-bash"], "bash", true), null);
  assert.deepEqual(toolsState(null).active, ["read", "bash", "edit", "write"]);
});

test("toolsState mirrors pi's ordered-list resolution", () => {
  // An empty-string entry is a plain entry: pi's replacing list resolves to no valid tools.
  const blank = toolsState([""]);
  assert.deepEqual(blank.active, [""]);
  assert.equal(blank.inherited, false);
  // An unrelated toggle keeps the resolved selection instead of enabling pi's defaults.
  assert.deepEqual(applyToolToggle([""], "read", false), [""]);
  // Duplicate plain names resolve by first-match removal.
  assert.deepEqual(toolsState(["read", "read", "-read"]).active, ["read"]);
  assert.deepEqual(applyToolToggle(["read", "read", "-read"], "grep", true), ["read", "grep"]);
  // Modifier-only lists still edit against pi's defaults.
  const modifierOnly = toolsState(["-bash"]);
  assert.equal(modifierOnly.inherited, true);
  // A no-op toggle on an explicit selection does not invent anything.
  assert.deepEqual(applyToolToggle(["read"], "bash", false), ["read"]);
});

test("readSettings parses defaultTools and codemode keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-tools-"));
  try {
    const env = { ...process.env, PI_CODING_AGENT_DIR: dir };
    await writeFile(join(dir, "settings.json"), JSON.stringify({
      defaultTools: ["-bash", "+codemode", "+acme/notes"],
      codemode: { mode: "only", inlineBudget: 2000, anotherKey: 1 },
    }));
    const settings = await readSettings(env);
    assert.deepEqual(settings.defaultTools, ["-bash", "+codemode", "+acme/notes"]);
    assert.deepEqual(settings.codemode, { mode: "only", inlineBudget: 2000 });
    // Unmodeled sibling codemode keys must survive the pruning of emptied keys.
    await writeSettings({ ...settings, codemode: { mode: null, inlineBudget: null } }, env);
    const after = JSON.parse(await readFile(join(dir, "settings.json"), "utf8"));
    assert.equal(after.codemode.mode, undefined);
    assert.equal(after.codemode.anotherKey, 1);
    assert.equal(after.codemode.inlineBudget, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeSettings removes defaultTools only when null, not when empty", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-tools-"));
  try {
    const env = { ...process.env, PI_CODING_AGENT_DIR: dir };
    await writeSettings(unsetPiSettings(), env);
    const absent = JSON.parse(await readFile(join(dir, "settings.json"), "utf8"));
    assert.equal(absent.defaultTools, undefined);
    assert.equal(absent.codemode, undefined);
    // An explicit [] is pi's "no built-in tools"; an unrelated save must keep it.
    await writeSettings(unsetPiSettings({ defaultTools: [] }), env);
    const explicit = JSON.parse(await readFile(join(dir, "settings.json"), "utf8"));
    assert.deepEqual(explicit.defaultTools, []);
    // A present non-array value resolves as pi's empty selection, not absence.
    await writeFile(join(dir, "settings.json"), JSON.stringify({ defaultTools: 42 }));
    const malformed = await readSettings(env);
    assert.deepEqual(malformed.defaultTools, []);
    // `codemode` being a non-object in a hand-edited file does not crash read or write.
    await writeFile(join(dir, "settings.json"), JSON.stringify({
      defaultTools: [],
      codemode: "hand-written junk",
      unrelated: { keep: true },
    }));
    const junk = await readSettings(env);
    assert.deepEqual(junk.defaultTools, []);
    assert.deepEqual(junk.codemode, { mode: null, inlineBudget: null });
    await writeSettings({ ...junk, codemode: { mode: "only", inlineBudget: null } }, env);
    const after = JSON.parse(await readFile(join(dir, "settings.json"), "utf8"));
    assert.deepEqual(after.codemode, { mode: "only" });
    assert.deepEqual(after.unrelated, { keep: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mcpConfigPath uses pi's agent-dir rules for file urls, tildes, and empty values", () => {
  assert.equal(mcpConfigPath({ ...process.env, PI_CODING_AGENT_DIR: "~/custom" }), join(process.env.HOME ?? "", "custom", "mcp.json"));
  assert.equal(mcpConfigPath({ ...process.env, PI_CODING_AGENT_DIR: "" }), join(process.env.HOME ?? "", ".pi", "agent", "mcp.json"));
  const expanded = mcpConfigPath({ ...process.env, PI_CODING_AGENT_DIR: "file:///virtual/pi%20agent" });
  assert.deepEqual(expanded.split("/").slice(1, 3), ["virtual", "pi agent"]);
  assert.equal(normalizeAgentDirValue("~/custom", "/home/u").startsWith("/home/u"), true);
});

test("readMcpServers summarizes stdio and http servers without env", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-mcp-"));
  try {
    const env = { ...process.env, PI_CODING_AGENT_DIR: dir };
    await writeFile(join(dir, "mcp.json"), JSON.stringify({
      mcpServers: {
        fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."], env: { SECRET: "x" } },
        docs: { url: "https://example.com/mcp" },
        dual: { type: "stdio", command: "node", url: "https://example.org/mcp" },
        streaming: { type: "streamable-http", url: "https://example.org/mcp" },
      },
      autoEnableCodemode: false,
    }));
    const report = await readMcpServers(env);
    assert.equal(report.error, null);
    assert.deepEqual(report.servers.map((server) => [server.name, server.transport, server.detail]), [
      ["fs", "stdio", "npx -y @modelcontextprotocol/server-filesystem ."],
      ["docs", "http", "https://example.com/mcp"],
      // An explicit type wins over a present url, as pi resolves it.
      ["dual", "stdio", "node"],
      ["streaming", "http", "https://example.org/mcp"],
    ]);
    assert.equal(report.autoEnableCodemode, false);
    assert.equal(JSON.stringify(report).includes("SECRET"), false);
    assert.deepEqual(report.invalid, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readMcpServers reports malformed shapes instead of inventing servers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-mcp-"));
  try {
    const env = { ...process.env, PI_CODING_AGENT_DIR: dir };
    await writeFile(join(dir, "mcp.json"), JSON.stringify({
      mcpServers: {
        "bad name": { command: "node" },
        badCommand: { command: 42 },
        commandArray: { command: ["node", "server.js"] },
        missingUrl: { type: "http" },
        badArgs: { command: "node", args: [null, 42] },
        badUrl: { url: "not a URL" },
        badEnv: { command: "node", env: { SECRET: 42 } },
        upper: { type: "stdio", command: "node" },
        // The legacy-SSE diagnostic, not the generic type message.
        legacySse: { type: "sse", url: "https://example.org/sse" },
      },
    }));
    const report = await readMcpServers(env);
    // sse is rejected; the exact-case "stdio" still resolves.
    assert.deepEqual(report.servers.map((server) => server.name), ["upper"]);
    assert.equal(report.invalid.length, 8);
    assert.match(report.invalid.find((reason) => reason.includes("legacy SSE")) ?? "", /streamable HTTP/);
    // A non-object root never crashes and is reported.
    for (const root of [null, [], "junk", 3]) {
      await writeFile(join(dir, "mcp.json"), JSON.stringify(root));
      const shaped = await readMcpServers(env);
      assert.deepEqual(shaped.servers, []);
      assert.notEqual(shaped.error, null);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readMcpServers reports ENOTDIR for a file used as the agent directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-mcp-"));
  try {
    // A file whose pathname contains "ENOENT" guards against message matching.
    const file = join(dir, "ENOENT");
    await writeFile(file, "{}");
    const env = { ...process.env, PI_CODING_AGENT_DIR: file };
    const report = await readMcpServers(env);
    assert.equal(report.error === null, false);
    assert.match(String(report.error), /ENOTDIR/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readMcpServers fails open with no file and reports broken json", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-mcp-"));
  try {
    const env = { ...process.env, PI_CODING_AGENT_DIR: dir };
    const empty = await readMcpServers(env);
    assert.deepEqual(empty.servers, []);
    assert.equal(empty.error, null);
    assert.deepEqual(empty.invalid, []);
    await writeFile(join(dir, "mcp.json"), "{ not json");
    const broken = await readMcpServers(env);
    assert.deepEqual(broken.servers, []);
    assert.notEqual(broken.error, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("exposure aliases are accepted and toolExposure values are validated", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-mcp-"));
  try {
    const env = { ...process.env, PI_CODING_AGENT_DIR: dir };
    await writeFile(join(dir, "mcp.json"), JSON.stringify({
      mcpServers: {
        hidden: { command: "node", exposure: "hidden" },
        legacy: { command: "node", exposure: "codemode-deferred" },
        badValue: { command: "node", toolExposure: { danger: "garbage" } },
        numericValue: { command: "node", toolExposure: { danger: 42 } },
      },
    }));
    const report = await readMcpServers(env);
    assert.deepEqual(report.servers.map((server) => server.name), ["hidden", "legacy"]);
    assert.equal(report.invalid.length, 2);
    assert.match(report.invalid[0] ?? "", /toolExposure "danger"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("transport branching rejects the shapes pi rejects", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-mcp-"));
  try {
    const env = { ...process.env, PI_CODING_AGENT_DIR: dir };
    await writeFile(join(dir, "mcp.json"), JSON.stringify({
      mcpServers: {
        numericType: { type: 42, command: "node" },
        nullType: { type: null, url: "https://example.org/mcp" },
        streamableWithCommand: { type: "streamable-http", command: "node" },
      },
    }));
    const report = await readMcpServers(env);
    // A streamable-http type with a command but no url is not stdio.
    assert.deepEqual(report.servers, []);
    assert.equal(report.invalid.length, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});