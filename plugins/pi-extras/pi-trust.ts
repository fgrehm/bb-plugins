import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import lockfile from "proper-lockfile";
import type { DefaultProjectTrust, TrustCheck, TrustStatus } from "./trust-types.js";

/**
 * Pi requires a project-trust decision when a working directory ships one of
 * these resources. BB launches `pi --mode rpc` without `--approve`, and RPC
 * mode cannot show Pi's prompt, so an absent decision means these resources
 * are skipped silently. This module mirrors Pi's own scan and decision lookup
 * (packages/coding-agent/src/core/trust-manager.ts and project-trust.ts) so the
 * plugin can tell the user what a Pi thread is not loading.
 */
const TRUST_REQUIRING_CONFIG_RESOURCES = [
  "settings.json",
  "mcp.json",
  "extensions",
  "skills",
  "prompts",
  "themes",
  "SYSTEM.md",
  "APPEND_SYSTEM.md",
] as const;

export type { DefaultProjectTrust, TrustCheck, TrustDecision, TrustStatus } from "./trust-types.js";

/** Convert Git Bash, MSYS, Cygwin, and WSL drive paths, as Pi does on Windows. */
function normalizeWindowsShellPath(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return path;
  const match = path.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);
  if (!match) return path;
  const suffix = match[2]?.replaceAll("/", "\\");
  return `${match[1]!.toUpperCase()}:\\${suffix ?? ""}`;
}

/**
 * Pi's `normalizePath` expands a leading tilde, converts `file://` URLs, and
 * normalizes Windows shell paths. It leaves any other relative value relative.
 */
export function normalizeAgentDirValue(value: string, home: string): string {
  if (process.platform === "win32") {
    value = normalizeWindowsShellPath(value);
  }
  if (value === "~") return home;
  if (value.startsWith("~/") || (process.platform === "win32" && value.startsWith("~\\"))) {
    return join(home, value.slice(2));
  }
  if (value.startsWith("file://")) return fileURLToPath(value);
  return value;
}

/**
 * Pi resolves `PI_CODING_AGENT_DIR` against its own working directory, which
 * for a BB thread is the thread's workspace. `baseDir` is that workspace; when
 * callers omit it the process directory is the closest available answer.
 */
export function agentDir(env: NodeJS.ProcessEnv = process.env, baseDir: string = process.cwd()): string {
  // Pi preserves whitespace in this value and only expands a leading tilde.
  const configured = env.PI_CODING_AGENT_DIR;
  if (configured === undefined || configured === "") {
    return join(env.HOME || homedir(), ".pi", "agent");
  }
  const expanded = normalizeAgentDirValue(configured, env.HOME || homedir());
  return isAbsolute(expanded) ? expanded : resolve(baseDir, expanded);
}

export function trustFilePath(env: NodeJS.ProcessEnv = process.env, baseDir?: string): string {
  return join(agentDir(env, baseDir), "trust.json");
}

/** Pi canonicalizes with realpath and falls back to the raw path for missing targets. */
export function canonicalizePath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function parentOf(path: string): string | null {
  const parent = dirname(path);
  return parent === path ? null : parent;
}

/**
 * Pi's `hasTrustRequiringProjectResources`: trust-gated entries under
 * `<cwd>/.pi`, plus `.agents/skills` from cwd up to the filesystem root. The
 * user-level `~/.agents/skills` is a trusted user resource and never counts.
 */
export function findTrustRequiringResources(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const home = env.HOME || homedir();
  const userAgentsSkills = join(canonicalizePath(home), ".agents", "skills");
  const resources: string[] = [];
  let current = canonicalizePath(cwd);

  const configDir = join(current, ".pi");
  for (const entry of TRUST_REQUIRING_CONFIG_RESOURCES) {
    const candidate = join(configDir, entry);
    if (existsSync(candidate)) resources.push(candidate);
  }

  while (true) {
    const agentsSkills = join(current, ".agents", "skills");
    if (agentsSkills !== userAgentsSkills && existsSync(agentsSkills)) resources.push(agentsSkills);
    const parent = parentOf(current);
    if (parent === null) break;
    current = parent;
  }
  return resources;
}

function isMissing(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === "ENOENT" || error.code === "ENOTDIR";
}

/**
 * Reads a JSON object, or null when the file genuinely does not exist. Any
 * other failure propagates: Pi distinguishes "no store yet" from "cannot read
 * the store", and treating a permission error as empty would let a save
 * replace decisions this process never saw.
 */
function readJsonRecord(path: string): Record<string, unknown> | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  const parsed: unknown = JSON.parse(stripBom(raw));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

/** Pi refuses a store whose values are not decisions, rather than ignoring them. */
function parseTrustStore(path: string): Record<string, boolean | null> | null {
  const raw = readJsonRecord(path);
  if (raw === null) return null;
  for (const [key, value] of Object.entries(raw)) {
    if (value !== true && value !== false && value !== null) {
      throw new Error(`value for ${JSON.stringify(key)} must be true, false, or null`);
    }
  }
  return raw as Record<string, boolean | null>;
}

/** The directory a saved decision resolves from, closest parent first, like Pi. */
export function findSavedDecision(
  store: Readonly<Record<string, unknown>>,
  cwd: string,
): { path: string; decision: boolean } | null {
  let current = canonicalizePath(cwd);
  while (true) {
    const value = store[current];
    if (value === true || value === false) return { path: current, decision: value };
    const parent = parentOf(current);
    if (parent === null) return null;
    current = parent;
  }
}

export function readDefaultProjectTrust(
  env: NodeJS.ProcessEnv = process.env,
  baseDir?: string,
): DefaultProjectTrust {
  try {
    const settings = readJsonRecord(join(agentDir(env, baseDir), "settings.json"));
    const value = settings?.defaultProjectTrust;
    return value === "always" || value === "never" ? value : "ask";
  } catch {
    // An unreadable settings file contributes nothing; "ask" is the safe answer.
    return "ask";
  }
}

/**
 * Pi's decision order is `--approve`/`--no-approve` (BB passes neither), then a
 * `project_trust` handler in an extension, then a saved decision, then the
 * global default. This cannot see extension answers, so a report of
 * "untrusted" is what Pi does when no extension claims the decision; the
 * plugin says so wherever the result is shown.
 */
export function readTrustCheck(path: string, env: NodeJS.ProcessEnv = process.env): TrustCheck {
  const canonicalPath = canonicalizePath(path);
  const resources = findTrustRequiringResources(canonicalPath, env);
  const defaultProjectTrust = readDefaultProjectTrust(env, canonicalPath);

  const base = {
    path,
    hostId: null,
    storePath: trustFilePath(env, canonicalPath),
    canonicalPath,
    resources,
    savedDecision: null,
    savedDecisionPath: null,
    defaultProjectTrust,
    error: null,
  } satisfies Omit<TrustCheck, "trusted" | "status" | "canTrust">;

  // Pi answers this before it touches the trust store, so an unreadable store
  // is irrelevant to a workspace with nothing to gate.
  if (resources.length === 0) {
    return { ...base, trusted: true, status: "no-resources", canTrust: false };
  }

  let saved: { path: string; decision: boolean } | null = null;
  try {
    const store = parseTrustStore(trustFilePath(env, canonicalPath)) ?? {};
    saved = findSavedDecision(store, canonicalPath);
  } catch (cause) {
    // Pi cannot read the decision either, so this is not "untrusted by policy";
    // it is unknown. Fail closed: never claim the resources loaded, never offer
    // to overwrite a store the user cannot read.
    return {
      ...base,
      hostId: null,
      savedDecision: null,
      savedDecisionPath: null,
      trusted: false,
      status: "unknown",
      canTrust: false,
      error: `Unable to read Pi's trust store: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }

  const trusted = saved?.decision ?? defaultProjectTrust === "always";
  const status: TrustStatus = trusted ? "trusted" : "untrusted";
  return {
    ...base,
    savedDecision: saved?.decision ?? null,
    savedDecisionPath: saved?.path ?? null,
    trusted,
    status,
    canTrust: !trusted,
  };
}

/**
 * Pi's trust store uses the same lock file (`trust.json.lock`) and the sync
 * API has no retry option, so wait briefly for a concurrent Pi process the
 * same way Pi does.
 */
function withTrustFileLock<T>(path: string, fn: () => T): T {
  const lockDir = dirname(path);
  mkdirSync(lockDir, { recursive: true });
  const maxAttempts = 10;
  let release: (() => void) | null = null;
  for (let attempt = 1; attempt <= maxAttempts && release === null; attempt++) {
    try {
      release = lockfile.lockSync(lockDir, { realpath: false, lockfilePath: `${path}.lock` });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
      if (code !== "ELOCKED" || attempt === maxAttempts) throw error;
      const start = Date.now();
      while (Date.now() - start < 20) {
        // Pi blocks synchronously here as well; callers are short host calls.
      }
    }
  }
  try {
    return fn();
  } finally {
    release?.();
  }
}

/**
 * A store may be a symlink, and its target may be another dangling symlink.
 * Follow the whole chain, with loop detection, so the write lands on the final
 * target instead of replacing an intermediate link with a regular file.
 */
function resolveStoreTarget(path: string): string {
  let current = path;
  const seen = new Set<string>();
  for (let hop = 0; hop < 20; hop++) {
    let stats;
    try {
      stats = lstatSync(current);
    } catch (error) {
      if (isMissing(error)) return current;
      throw error;
    }
    if (!stats.isSymbolicLink()) return current;
    if (seen.has(current)) throw new Error(`Pi's trust store symlink loops at ${current}`);
    seen.add(current);
    const link = readlinkSync(current);
    current = isAbsolute(link) ? link : resolve(dirname(current), link);
  }
  throw new Error(`Pi's trust store symlink chain is too long at ${path}`);
}

function writeTrustFile(path: string, store: Record<string, unknown>): void {
  const sorted: Record<string, boolean | null> = {};
  for (const key of Object.keys(store).sort()) {
    const value = store[key];
    // Pi keeps `null` tombstones; dropping them would resurrect old decisions.
    if (value === true || value === false || value === null) sorted[key] = value;
  }
  mkdirSync(dirname(path), { recursive: true });

  // Resolve a symlinked store to its target, then replace the target
  // atomically. Writing in place would truncate the existing store first, so a
  // failed write could lose decisions this process never read.
  const target = resolveStoreTarget(path);
  const existingMode = existsSync(target) ? statSync(target).mode & 0o777 : undefined;
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temp, `${JSON.stringify(sorted, null, 2)}\n`, {
      encoding: "utf8",
      ...(existingMode === undefined ? {} : { mode: existingMode }),
    });
    if (existingMode !== undefined) chmodSync(temp, existingMode);
    renameSync(temp, target);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // The temp file was never created or already replaced.
    }
    throw error;
  }
}

/**
 * Saves exactly what `pi /trust` saves for this directory: one canonical
 * directory key with `true`. Every other entry Pi owns is preserved, including
 * `null` tombstones. `expectedCanonicalPath` binds the write to the workspace
 * the user saw: a symlink retarget or an environment move rejects it.
 *
 * Callers must only reach this after an explicit user action; nothing here is
 * triggered by detection.
 */
export function saveTrustDecision(
  path: string,
  env: NodeJS.ProcessEnv = process.env,
  expectedCanonicalPath?: string,
): TrustCheck {
  const canonicalPath = canonicalizePath(path);
  if (expectedCanonicalPath !== undefined && expectedCanonicalPath !== canonicalPath) {
    throw new Error(
      `The workspace changed from ${expectedCanonicalPath} to ${canonicalPath}; review the new path and try again`,
    );
  }
  const storePath = trustFilePath(env, canonicalPath);
  withTrustFileLock(storePath, () => {
    let store: Record<string, boolean | null> = {};
    try {
      store = parseTrustStore(storePath) ?? {};
    } catch (cause) {
      // Pi refuses an unreadable or invalid store too; refuse rather than
      // overwrite decisions this process could not read.
      throw new Error(
        `Pi's trust store is unreadable (${cause instanceof Error ? cause.message : String(cause)}); fix or remove ${storePath} first`,
      );
    }
    writeTrustFile(storePath, { ...store, [canonicalPath]: true });
  });
  return readTrustCheck(canonicalPath, env);
}

/** True when the trust store changed since the cached read, so the cache can stay short. */
export function trustStoreStamp(env: NodeJS.ProcessEnv = process.env, baseDir?: string): string {
  try {
    const stats = statSync(trustFilePath(env, baseDir));
    return `${stats.mtimeMs}:${stats.size}`;
  } catch (error) {
    // An unreadable store must not look like "no store": both change the file
    // stamp when repaired, but distinguishing them keeps the cache honest.
    return isMissing(error) ? "missing" : "unreadable";
  }
}

const CACHE_TTL_MS = 5_000;
const cache = new Map<string, { stamp: string; checkedAt: number; check: TrustCheck }>();

/** A short cache, like the plugin's model and usage reads, so repeated row reads stay cheap. */
export function readTrustCheckCached(path: string, env: NodeJS.ProcessEnv = process.env): TrustCheck {
  const baseDir = canonicalizePath(path);
  const key = `${baseDir}\u0000${agentDir(env, baseDir)}`;
  const stamp = trustStoreStamp(env, baseDir);
  const hit = cache.get(key);
  if (hit !== undefined && hit.stamp === stamp && Date.now() - hit.checkedAt < CACHE_TTL_MS) return hit.check;
  const check = readTrustCheck(path, env);
  if (check.status !== "unknown") {
    cache.set(key, { stamp, checkedAt: Date.now(), check });
    if (cache.size > 200) cache.clear();
  }
  return check;
}

export function clearTrustCheckCache(): void {
  cache.clear();
}

/**
 * The host's read handler. A forced read clears the cache first, so a
 * following ordinary read cannot reuse an observation the forced read
 * invalidated (for example after a store becomes unreadable).
 */
export function readTrustChecksForPaths(
  paths: readonly string[],
  force: boolean,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, TrustCheck> {
  if (force) clearTrustCheckCache();
  return Object.fromEntries(
    paths.map((path) => [path, force ? readTrustCheck(path, env) : readTrustCheckCached(path, env)]),
  );
}
