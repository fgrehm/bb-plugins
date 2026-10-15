import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseBranchName,
  parseUpstream,
  readBaseRefs,
  resolveBaseSuggestion,
} from "./git-base-branch";

const base = {
  branchName: "feature/review",
  baseBranch: null,
  mergeBaseBranch: null,
  defaultBranch: "main",
  upstream: null,
  remoteDefault: null,
};

describe("resolveBaseSuggestion", () => {
  it("prefers the host's resolved merge base", () => {
    expect(
      resolveBaseSuggestion({
        ...base,
        mergeBaseBranch: "release/1.0",
        baseBranch: "main",
        upstream: "origin/main",
      }),
    ).toMatchObject({
      suggestedBase: "release/1.0",
      source: "environment-merge-base",
    });
  });

  it("falls back through environment base, upstream, remote default, local default", () => {
    expect(
      resolveBaseSuggestion({
        ...base,
        baseBranch: "develop",
        upstream: "origin/main",
        remoteDefault: "origin/main",
      }),
    ).toMatchObject({ suggestedBase: "develop", source: "environment-base" });
    expect(
      resolveBaseSuggestion({ ...base, upstream: "origin/main" }),
    ).toMatchObject({ suggestedBase: "origin/main", source: "upstream" });
    expect(
      resolveBaseSuggestion({ ...base, remoteDefault: "upstream/main" }),
    ).toMatchObject({
      suggestedBase: "upstream/main",
      source: "remote-default",
    });
    expect(resolveBaseSuggestion(base)).toMatchObject({
      suggestedBase: "main",
      source: "local-default",
    });
  });

  it("compares the default branch against its upstream instead of itself", () => {
    // The reported case: the checkout is already on main, so a local base would
    // capture nothing and the upstream is the useful comparison.
    const suggestion = resolveBaseSuggestion({
      ...base,
      branchName: "main",
      defaultBranch: "main",
      upstream: "origin/main",
      remoteDefault: "origin/main",
    });
    expect(suggestion).toMatchObject({
      suggestedBase: "origin/main",
      source: "upstream",
    });
  });

  it("never suggests the current branch and degrades to nothing", () => {
    expect(
      resolveBaseSuggestion({
        branchName: "main",
        baseBranch: "main",
        mergeBaseBranch: "main",
        defaultBranch: "main",
        upstream: "origin/main",
        remoteDefault: null,
      }),
    ).toMatchObject({ suggestedBase: "origin/main", source: "upstream" });
    expect(
      resolveBaseSuggestion({
        branchName: "main",
        baseBranch: null,
        mergeBaseBranch: null,
        defaultBranch: "main",
        upstream: null,
        remoteDefault: null,
      }),
    ).toMatchObject({ suggestedBase: null, source: null });
    expect(
      resolveBaseSuggestion({
        branchName: "main",
        baseBranch: "main",
        mergeBaseBranch: "main",
        defaultBranch: "main",
        upstream: "main",
        remoteDefault: "origin/main",
      }),
    ).toMatchObject({ suggestedBase: "origin/main", source: "remote-default" });
  });

  it("ignores blank values and trims the winner", () => {
    expect(
      resolveBaseSuggestion({
        ...base,
        baseBranch: "   ",
        upstream: " origin/main ",
      }),
    ).toMatchObject({ suggestedBase: "origin/main", source: "upstream" });
  });

  it("treats a detached HEAD and a missing upstream as unknown", () => {
    expect(parseBranchName("HEAD")).toBeNull();
    expect(parseBranchName("\u0000")).toBeNull();
    expect(parseUpstream("HEAD")).toBeNull();
    expect(parseUpstream("\u0000")).toBeNull();
    expect(parseUpstream("origin/main\n")).toBe("origin/main");
  });
});

describe("readBaseRefs", () => {
  it("resolves the upstream and remote default from a real checkout", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-git-base-"));
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: dir, stdio: "pipe" });
    try {
      git("init", "-q", "-b", "main");
      git("config", "user.email", "test@example.com");
      git("config", "user.name", "Test");
      writeFileSync(join(dir, "a.txt"), "a\n");
      git("add", ".");
      git("commit", "-qm", "init");
      git("remote", "add", "origin", "https://example.com/repo.git");
      git("config", "branch.main.remote", "origin");
      git("config", "branch.main.merge", "refs/heads/main");
      git("update-ref", "refs/remotes/origin/main", "HEAD");

      expect(
        await readBaseRefs(dir, {
          defaultBranch: "main",
          hostBranchName: null,
        }),
      ).toEqual({
        branchName: "main",
        upstream: "origin/main",
        remoteDefault: "origin/main",
      });

      // A detached HEAD has no branch of its own to compare against.
      git("checkout", "-q", "--detach", "HEAD");
      expect(
        await readBaseRefs(dir, {
          defaultBranch: "main",
          hostBranchName: null,
        }),
      ).toEqual({
        branchName: null,
        upstream: null,
        remoteDefault: "origin/main",
      });

      // Without a default branch there is no remote ref to probe.
      expect(
        await readBaseRefs(dir, {
          defaultBranch: null,
          hostBranchName: "main",
        }),
      ).toMatchObject({ branchName: "main", remoteDefault: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("degrades quietly outside a repository", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-git-none-"));
    try {
      expect(
        await readBaseRefs(dir, {
          defaultBranch: "main",
          hostBranchName: null,
        }),
      ).toEqual({ branchName: null, upstream: null, remoteDefault: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
