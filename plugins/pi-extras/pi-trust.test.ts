import assert from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "node:test";
import {
  agentDir,
  readTrustChecksForPaths,
  clearTrustCheckCache,
  findTrustRequiringResources,
  readDefaultProjectTrust,
  readTrustCheck,
  readTrustCheckCached,
  saveTrustDecision,
  trustFilePath,
} from "./pi-trust.ts";

const roots: string[] = [];
/**
 * Fixtures live under the repository's git-ignored `.tmp/`, not the system
 * temp directory, so a sandboxed agent workspace can still create them.
 */
const TEMP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".tmp", "pi-trust");

function sandbox(): { home: string; workspace: string; env: NodeJS.ProcessEnv } {
  mkdirSync(TEMP_ROOT, { recursive: true });
  const root = realpathSync(mkdtempSync(join(TEMP_ROOT, "case-")));
  roots.push(root);
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  mkdirSync(home, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  return { home, workspace, env: { HOME: home } };
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function touch(path: string): void {
  mkdirSync(path, { recursive: true });
}

function agentSettings(env: NodeJS.ProcessEnv, value: unknown): void {
  writeJson(join(env.HOME!, ".pi", "agent", "settings.json"), value);
}

function trustStore(env: NodeJS.ProcessEnv, value: unknown): void {
  writeJson(trustFilePath(env), value);
}

afterEach(() => {
  clearTrustCheckCache();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("findTrustRequiringResources", () => {
  it("finds Pi's gated .pi entries in the order Pi scans them", () => {
    const { workspace, env } = sandbox();
    touch(join(workspace, ".pi"));
    writeFileSync(join(workspace, ".pi", "settings.json"), "{}");
    touch(join(workspace, ".pi", "skills"));
    touch(join(workspace, ".pi", "themes"));

    assert.deepEqual(findTrustRequiringResources(workspace, env), [
      join(workspace, ".pi", "settings.json"),
      join(workspace, ".pi", "skills"),
      join(workspace, ".pi", "themes"),
    ]);
  });

  it("treats a bare .pi directory as needing no trust", () => {
    const { workspace, env } = sandbox();
    touch(join(workspace, ".pi"));
    assert.deepEqual(findTrustRequiringResources(workspace, env), []);
  });

  it("counts .agents/skills in the workspace and its ancestors", () => {
    const { workspace, env } = sandbox();
    touch(join(workspace, ".agents", "skills"));
    touch(join(workspace, "nested", "pkg", ".agents", "skills"));
    assert.deepEqual(findTrustRequiringResources(join(workspace, "nested", "pkg"), env), [
      join(workspace, "nested", "pkg", ".agents", "skills"),
      join(workspace, ".agents", "skills"),
    ]);
  });

  it("ignores the user-level ~/.agents/skills", () => {
    const { home, workspace, env } = sandbox();
    touch(join(home, ".agents", "skills"));
    assert.deepEqual(findTrustRequiringResources(workspace, env), []);
  });
});

describe("readTrustCheck", () => {
  it("reports no-resources for a workspace Pi does not gate", () => {
    const { workspace, env } = sandbox();
    const check = readTrustCheck(workspace, env);
    assert.equal(check.status, "no-resources");
    assert.equal(check.trusted, true);
    assert.equal(check.canTrust, false);
    assert.deepEqual(check.resources, []);
  });

  it("is untrusted when resources exist and nothing decides", () => {
    const { workspace, env } = sandbox();
    touch(join(workspace, ".pi", "skills"));
    const check = readTrustCheck(workspace, env);
    assert.equal(check.status, "untrusted");
    assert.equal(check.trusted, false);
    assert.equal(check.canTrust, true);
    assert.equal(check.savedDecision, null);
    assert.equal(check.defaultProjectTrust, "ask");
  });

  it("honors a saved decision, including one for a parent directory", () => {
    const { workspace, env } = sandbox();
    touch(join(workspace, ".pi", "skills"));
    trustStore(env, { [workspace]: true });
    assert.equal(readTrustCheck(workspace, env).trusted, true);

    const child = join(workspace, "child");
    touch(join(child, ".agents", "skills"));
    const inherited = readTrustCheck(child, env);
    assert.equal(inherited.trusted, true);
    assert.equal(inherited.savedDecisionPath, workspace);
  });

  it("lets the closest saved decision win over a parent decision", () => {
    const { workspace, env } = sandbox();
    const child = join(workspace, "child");
    touch(join(child, ".pi", "mcp.json"));
    trustStore(env, { [workspace]: true, [child]: false });
    const check = readTrustCheck(child, env);
    assert.equal(check.trusted, false);
    assert.equal(check.savedDecisionPath, child);
  });

  it("follows defaultProjectTrust when no decision is saved", () => {
    const { workspace, env } = sandbox();
    touch(join(workspace, ".pi", "settings.json"));

    agentSettings(env, { defaultProjectTrust: "always" });
    assert.equal(readTrustCheck(workspace, env).trusted, true);
    assert.equal(readTrustCheck(workspace, env).status, "trusted");

    agentSettings(env, { defaultProjectTrust: "never" });
    assert.equal(readTrustCheck(workspace, env).trusted, false);

    agentSettings(env, { defaultProjectTrust: "ask" });
    assert.equal(readTrustCheck(workspace, env).trusted, false);
  });

  it("treats an unknown defaultProjectTrust value as ask", () => {
    const { workspace, env } = sandbox();
    agentSettings(env, { defaultProjectTrust: "sometimes" });
    assert.equal(readDefaultProjectTrust(env), "ask");
    touch(join(workspace, ".pi"));
    writeFileSync(join(workspace, ".pi", "SYSTEM.md"), "hi");
    assert.equal(readTrustCheck(workspace, env).trusted, false);
  });

  it("reports an unreadable trust store instead of guessing", () => {
    const { workspace, env } = sandbox();
    touch(join(workspace, ".pi", "extensions"));
    mkdirSync(join(env.HOME!, ".pi", "agent"), { recursive: true });
    writeFileSync(trustFilePath(env), "{ not json");
    const check = readTrustCheck(workspace, env);
    assert.equal(check.status, "unknown");
    assert.equal(check.trusted, false);
    assert.match(check.error ?? "", /trust store/i);
  });

  it("keeps Pi's tombstone values readable", () => {
    const { workspace, env } = sandbox();
    touch(join(workspace, ".pi", "prompts"));
    trustStore(env, { [workspace]: null, [join(workspace, "parent")]: true });
    const check = readTrustCheck(workspace, env);
    assert.equal(check.savedDecision, null);
    assert.equal(check.trusted, false);
  });
});

describe("trust store failures", () => {
  it("reports an unreadable store as unknown instead of trusted", () => {
    const { workspace, env } = sandbox();
    touch(join(workspace, ".pi", "skills"));
    agentSettings(env, { defaultProjectTrust: "always" });
    mkdirSync(join(env.HOME!, ".pi", "agent"), { recursive: true });
    trustStore(env, { [workspace]: true });
    chmodSync(trustFilePath(env), 0o000);
    try {
      const check = readTrustCheck(workspace, env);
      assert.equal(check.status, "unknown");
      assert.equal(check.trusted, false);
      assert.equal(check.canTrust, false);
      assert.match(check.error ?? "", /trust store/i);
    } finally {
      chmodSync(trustFilePath(env), 0o600);
    }
  });

  it("refuses to replace a store it cannot read", () => {
    const { workspace, env } = sandbox();
    touch(join(workspace, ".pi", "skills"));
    trustStore(env, { "/other/workspace": true });
    chmodSync(trustFilePath(env), 0o000);
    try {
      assert.throws(() => saveTrustDecision(workspace, env), /unreadable/i);
      chmodSync(trustFilePath(env), 0o600);
      assert.deepEqual(JSON.parse(readFileSync(trustFilePath(env), "utf8")), { "/other/workspace": true });
    } finally {
      try {
        chmodSync(trustFilePath(env), 0o600);
      } catch {
        // Already restored above.
      }
    }
  });

  it("leaves the store intact when the target write fails", () => {
    const { home, workspace, env } = sandbox();
    touch(join(workspace, ".pi", "skills"));
    const targetDir = join(home, "store-target");
    mkdirSync(targetDir, { recursive: true });
    const target = join(targetDir, "trust.json");
    writeFileSync(target, JSON.stringify({ "/other/workspace": true }, null, 2));
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    symlinkSync(target, trustFilePath(env));
    const before = readFileSync(target, "utf8");

    // The agent directory stays writable so the lock is created and the writer
    // runs; only the resolved target directory rejects the temp file.
    chmodSync(targetDir, 0o500);
    try {
      assert.throws(() => saveTrustDecision(workspace, env));
    } finally {
      chmodSync(targetDir, 0o700);
    }

    assert.equal(readFileSync(target, "utf8"), before);
    assert.equal(lstatSync(trustFilePath(env)).isSymbolicLink(), true);
  });

  it("rejects a write when the workspace moved after it was displayed", () => {
    const { workspace, env } = sandbox();
    touch(join(workspace, ".pi", "skills"));
    trustStore(env, {});
    assert.throws(
      () => saveTrustDecision(workspace, env, join(workspace, "elsewhere")),
      /workspace changed/,
    );
    assert.deepEqual(JSON.parse(readFileSync(trustFilePath(env), "utf8")), {});
  });

  it("follows a dangling store symlink instead of replacing it", () => {
    const { workspace, env } = sandbox();
    touch(join(workspace, ".pi", "skills"));
    const targetDir = join(env.HOME!, "shared");
    mkdirSync(targetDir, { recursive: true });
    const target = join(targetDir, "trust.json");
    mkdirSync(join(env.HOME!, ".pi", "agent"), { recursive: true });
    symlinkSync(target, trustFilePath(env));

    saveTrustDecision(workspace, env);

    assert.equal(lstatSync(trustFilePath(env)).isSymbolicLink(), true);
    assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { [workspace]: true });
  });

  it("follows a chain of dangling store symlinks", () => {
    const { home, workspace, env } = sandbox();
    touch(join(workspace, ".pi", "skills"));
    const dotfiles = join(home, "dotfiles", "pi");
    const state = join(home, "state", "pi");
    mkdirSync(dotfiles, { recursive: true });
    mkdirSync(state, { recursive: true });
    const finalTarget = join(state, "trust.json");
    symlinkSync(finalTarget, join(dotfiles, "trust.json"));
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    symlinkSync(join(dotfiles, "trust.json"), trustFilePath(env));

    saveTrustDecision(workspace, env);

    assert.equal(lstatSync(trustFilePath(env)).isSymbolicLink(), true);
    assert.equal(lstatSync(join(dotfiles, "trust.json")).isSymbolicLink(), true);
    assert.deepEqual(JSON.parse(readFileSync(finalTarget, "utf8")), { [workspace]: true });
  });

  it("writes through a symlinked store and keeps its mode", () => {
    const { workspace, env } = sandbox();
    touch(join(workspace, ".pi", "skills"));
    const realStore = join(env.HOME!, "linked-trust.json");
    writeFileSync(realStore, "{}\n");
    chmodSync(realStore, 0o640);
    mkdirSync(join(env.HOME!, ".pi", "agent"), { recursive: true });
    symlinkSync(realStore, trustFilePath(env));

    saveTrustDecision(workspace, env);

    assert.equal(lstatSync(trustFilePath(env)).isSymbolicLink(), true);
    assert.equal(statSync(realStore).mode & 0o777, 0o640);
    assert.deepEqual(JSON.parse(readFileSync(realStore, "utf8")), { [workspace]: true });
  });
});

describe("agent directory resolution", () => {
  it("accepts file URLs and decodes them like Pi", () => {
    const env = { HOME: "/home/tester", PI_CODING_AGENT_DIR: "file:///tmp/agent%20dir" };
    assert.equal(agentDir(env, "/workspace"), "/tmp/agent dir");
  });

  it("expands a leading tilde like Pi", () => {
    const env = { HOME: "/home/tester", PI_CODING_AGENT_DIR: "~/.pi-custom" };
    assert.equal(agentDir(env, "/workspace"), "/home/tester/.pi-custom");
  });

  it("resolves a relative value against the thread workspace", () => {
    const env = { HOME: "/home/tester", PI_CODING_AGENT_DIR: ".pi-custom" };
    assert.equal(agentDir(env, "/workspace"), "/workspace/.pi-custom");
  });

  it("reads settings from the configured directory", () => {
    const { workspace, env } = sandbox();
    touch(join(workspace, ".pi", "skills"));
    env.PI_CODING_AGENT_DIR = ".pi-custom";
    writeJson(join(workspace, ".pi-custom", "settings.json"), { defaultProjectTrust: "always" });
    assert.equal(readTrustCheck(workspace, env).trusted, true);
  });
});

describe("saveTrustDecision", () => {
  it("writes one canonical entry and preserves Pi's other entries", () => {
    const { workspace, env } = sandbox();
    touch(join(workspace, ".pi", "skills"));
    const other = join(workspace, "other");
    trustStore(env, { [other]: false, [workspace]: null });

    const check = saveTrustDecision(workspace, env);

    assert.equal(check.trusted, true);
    assert.equal(check.status, "trusted");
    assert.equal(check.savedDecisionPath, workspace);
    assert.deepEqual(JSON.parse(readFileSync(trustFilePath(env), "utf8")), {
      [other]: false,
      [workspace]: true,
    });
  });

  it("creates the trust store and its directory when Pi never saved one", () => {
    const { workspace, env } = sandbox();
    touch(join(workspace, ".agents", "skills"));
    const check = saveTrustDecision(workspace, env);
    assert.equal(check.trusted, true);
    assert.deepEqual(JSON.parse(readFileSync(trustFilePath(env), "utf8")), { [workspace]: true });
  });

  it("refuses to overwrite a malformed trust store", () => {
    const { workspace, env } = sandbox();
    touch(join(workspace, ".pi"));
    writeFileSync(join(workspace, ".pi", "skills"), "");
    mkdirSync(join(env.HOME!, ".pi", "agent"), { recursive: true });
    writeFileSync(trustFilePath(env), "[]");
    assert.throws(() => saveTrustDecision(workspace, env), /unreadable/i);
    assert.equal(readFileSync(trustFilePath(env), "utf8"), "[]");
  });

  it("keeps null tombstones and refuses entries that are not decisions", () => {
    const { workspace, env } = sandbox();
    touch(join(workspace, ".pi", "skills"));
    trustStore(env, { keep: null, drop: "yes" });
    assert.throws(() => saveTrustDecision(workspace, env), /must be true, false, or null/);
    assert.equal(JSON.parse(readFileSync(trustFilePath(env), "utf8")).drop, "yes");

    trustStore(env, { keep: null });
    saveTrustDecision(workspace, env);
    assert.deepEqual(JSON.parse(readFileSync(trustFilePath(env), "utf8")), {
      [workspace]: true,
      keep: null,
    });
  });
});

describe("host forced reads", () => {
  it("clears the cache so an ordinary read cannot reuse an invalidated answer", () => {
    const { workspace, env } = sandbox();
    touch(join(workspace, ".agents", "skills"));
    mkdirSync(join(env.HOME!, ".pi", "agent"), { recursive: true });
    const store = join(env.HOME!, ".pi", "agent", "trust.json");
    writeFileSync(store, JSON.stringify({ [workspace]: true }));

    assert.equal(readTrustChecksForPaths([workspace], false, env)[workspace]?.trusted, true);
    chmodSync(store, 0o000);
    try {
      assert.equal(readTrustChecksForPaths([workspace], true, env)[workspace]?.status, "unknown");
      // The forced read cleared the host cache, so this cannot return trusted.
      assert.equal(readTrustChecksForPaths([workspace], false, env)[workspace]?.status, "unknown");
    } finally {
      chmodSync(store, 0o600);
    }
  });
});

describe("readTrustCheckCached", () => {
  it("does not cache an unknown observation", () => {
    const { workspace, env } = sandbox();
    touch(join(workspace, ".pi", "skills"));
    mkdirSync(join(env.HOME!, ".pi", "agent"), { recursive: true });
    writeFileSync(trustFilePath(env), "not json");
    assert.equal(readTrustCheckCached(workspace, env).status, "unknown");
    writeFileSync(trustFilePath(env), JSON.stringify({ [workspace]: true }));
    assert.equal(readTrustCheckCached(workspace, env).trusted, true);
  });

  it("reuses a check until the trust store changes", () => {
    const { workspace, env } = sandbox();
    touch(join(workspace, ".pi", "skills"));
    assert.equal(readTrustCheckCached(workspace, env).trusted, false);
    saveTrustDecision(workspace, env);
    assert.equal(readTrustCheckCached(workspace, env).trusted, true);
  });
});
