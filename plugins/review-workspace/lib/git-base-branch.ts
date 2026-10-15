// Suggests a base branch for "Committed vs base" / "Everything vs base" review
// targets from the thread's environment, so a checkout that is already on the
// default branch compares against its upstream instead of itself.
import { spawn } from "node:child_process";

export type BaseSuggestionSource =
  | "environment-merge-base"
  | "environment-base"
  | "upstream"
  | "remote-default"
  | "local-default";

export type BaseSuggestion = {
  suggestedBase: string | null;
  source: BaseSuggestionSource | null;
  branchName: string | null;
  upstream: string | null;
  remoteDefault: string | null;
};

export type BaseSuggestionInput = {
  branchName: string | null;
  baseBranch: string | null;
  mergeBaseBranch: string | null;
  defaultBranch: string | null;
  upstream: string | null;
  remoteDefault: string | null;
};

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Resolution order, most specific first:
 * 1. the host's resolved merge base for this environment (managed worktrees),
 * 2. the branch the environment was created from,
 * 3. the current branch's configured upstream (on a default branch this is what
 *    "not pushed yet" means; comparing to the local default would be a no-op),
 * 4. the remote's default branch,
 * 5. the local default branch.
 * A candidate equal to the current branch is skipped: it would capture nothing.
 */
export function resolveBaseSuggestion(
  input: BaseSuggestionInput,
): BaseSuggestion {
  const branchName = clean(input.branchName);
  const upstream = clean(input.upstream);
  const remoteDefault = clean(input.remoteDefault);
  const candidates: Array<{
    value: string | null;
    source: BaseSuggestionSource;
  }> = [
    {
      value: clean(input.mergeBaseBranch),
      source: "environment-merge-base",
    },
    { value: clean(input.baseBranch), source: "environment-base" },
    { value: upstream, source: "upstream" },
    { value: remoteDefault, source: "remote-default" },
    { value: clean(input.defaultBranch), source: "local-default" },
  ];
  for (const candidate of candidates) {
    if (!candidate.value) continue;
    if (branchName && candidate.value === branchName) continue;
    return {
      suggestedBase: candidate.value,
      source: candidate.source,
      branchName,
      upstream,
      remoteDefault,
    };
  }
  return {
    suggestedBase: null,
    source: null,
    branchName,
    upstream,
    remoteDefault,
  };
}

const MISSING = "\u0000";

function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve) => {
    // Ref lookups are advisory: a missing upstream or remote must never fail
    // the caller, so failures resolve to the MISSING marker instead of throwing.
    const child = spawn("git", args, { cwd });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", () => {});
    child.on("error", () => resolve(MISSING));
    child.on("close", (code) => resolve(code === 0 ? stdout.trim() : MISSING));
  });
}

export function parseUpstream(raw: string): string | null {
  if (raw === MISSING) return null;
  const value = raw.trim();
  if (!value || value === "HEAD") return null;
  return value;
}

export function parseBranchName(raw: string): string | null {
  if (raw === MISSING) return null;
  const value = raw.trim();
  // Detached HEAD reports "HEAD"; the environment metadata is the better source.
  if (!value || value === "HEAD") return null;
  return value;
}

/**
 * Reads the two refs the suggestion needs, plus a fallback for the branch name.
 * `defaultBranch` is the host's idea of the repository default; the remote is
 * taken from the configured upstream so a fork or a differently named remote
 * still resolves.
 */
export async function readBaseRefs(
  envPath: string,
  options: { defaultBranch: string | null; hostBranchName: string | null },
): Promise<{
  branchName: string | null;
  upstream: string | null;
  remoteDefault: string | null;
}> {
  const [branchRaw, upstreamRaw] = await Promise.all([
    options.hostBranchName
      ? Promise.resolve(options.hostBranchName)
      : runGit(["rev-parse", "--abbrev-ref", "HEAD"], envPath),
    runGit(
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      envPath,
    ),
  ]);
  const branchName = parseBranchName(branchRaw);
  const upstream = parseUpstream(upstreamRaw);
  const defaultBranch = clean(options.defaultBranch);
  let remoteDefault: string | null = null;
  if (defaultBranch) {
    const remote = upstream?.includes("/")
      ? upstream.slice(0, upstream.indexOf("/"))
      : "origin";
    const exists = await runGit(
      ["rev-parse", "--verify", "--quiet", `${remote}/${defaultBranch}`],
      envPath,
    );
    if (exists !== MISSING) remoteDefault = `${remote}/${defaultBranch}`;
  }
  return { branchName, upstream, remoteDefault };
}
