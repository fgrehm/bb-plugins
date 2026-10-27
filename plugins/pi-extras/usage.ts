import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type UsageStatus = "ok" | "not_configured" | "unavailable" | "expired" | "error";

export interface UsageWindow {
  label: string;
  usedPercent: number;
  resetsAt: string | null;
}

export interface UsageSource {
  id: "codex" | "opencode-go" | "ollama-cloud";
  label: string;
  status: UsageStatus;
  message: string | null;
  windows: UsageWindow[];
}

export interface PiUsageSnapshot {
  sources: UsageSource[];
}

type JsonRecord = Record<string, unknown>;
type FetchResponse = Pick<Response, "ok" | "status" | "json">;
type Fetcher = (input: string, init?: RequestInit) => Promise<FetchResponse>;
type ReadFile = (path: string, encoding: BufferEncoding) => Promise<string>;

interface Credentials {
  codex: { access: string; accountId: string } | null;
  openaiOAuthConfigured: boolean;
  opencodeGo: string | null;
  ollamaCloud: string | null;
}

export interface UsageReaderDependencies {
  fetch?: Fetcher;
  readFile?: ReadFile;
  authPath?: string;
}

// Undocumented ChatGPT backend endpoint. The Codex CLI polls the same URL and
// `codex app-server` exposes it as `account/rateLimits/read`, which is the other
// way to read this data (it needs a Codex CLI login). Only a Codex OAuth
// credential is accepted; see `parseCredentials`.
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const OPENCODE_GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
const OLLAMA_USAGE_URL = "https://ollama.com/api/balance";

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function boundedPercent(value: unknown): number | null {
  const number = numberValue(value);
  if (number === null || number < 0 || number > 100) return null;
  return Math.round(number);
}

function resetTime(value: unknown): string | null {
  const raw = stringValue(value);
  if (raw === null || Number.isNaN(Date.parse(raw))) return null;
  return new Date(raw).toISOString();
}

function unixResetTime(value: unknown): string | null {
  const seconds = numberValue(value);
  if (seconds === null || seconds <= 0) return null;
  return new Date(seconds * 1_000).toISOString();
}

function authFilePath(): string {
  return join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "auth.json");
}

export function parseCredentials(payload: unknown): Credentials {
  const root = asRecord(payload);
  // Pi stores two different ChatGPT sign-ins, and they are not interchangeable
  // for usage reads.
  //
  // `openai` is Sign in with ChatGPT (SIWC), granted against
  // `api.openai.com/v1` with scopes `openid profile email offline_access
  // resource.invoke chatgpt.tokens.use.direct`. Its token is audience-bound to
  // the Responses API, so this endpoint rejects it with 401
  // `rejected_by_access_enforcement` (`no_matching_rule`). The token also
  // carries no plan or account claims, only `encrypted_auth_metadata`. That is
  // a token-type limit, not a missing scope: requesting Codex's scopes would not
  // help. openai/codex#54219 tracks the gap for token-sharing apps, and OpenAI
  // has not answered it. Pi only links users to `chatgpt.com/settings/usage`.
  //
  // `openai-codex` is the Codex CLI OAuth credential, which the backend does
  // accept. Pi names the provider "OpenAI Codex (legacy)" since pi-ai 0.99.0,
  // where Sign in with ChatGPT superseded it. That is Pi's product naming, not
  // an OpenAI deprecation: Pi still ships and fixes it, and `/login` still
  // offers it as the ChatGPT Plus/Pro subscription sign-in.
  const openaiEntry = asRecord(root?.openai);
  const codexEntry = asRecord(root?.["openai-codex"]);
  const codexAccess = stringValue(codexEntry?.access);
  const codexAccountId = stringValue(codexEntry?.accountId);
  const openCodeEntry = asRecord(root?.["opencode-go"]);
  const ollamaEntry = asRecord(root?.["ollama-cloud"]);

  return {
    codex: codexAccess !== null && codexAccountId !== null
      ? { access: codexAccess, accountId: codexAccountId }
      : null,
    openaiOAuthConfigured: stringValue(openaiEntry?.access) !== null,
    opencodeGo: stringValue(openCodeEntry?.key),
    ollamaCloud: stringValue(ollamaEntry?.key),
  };
}

// The payload does not guarantee `primary_window` = 5 hours. Each window
// declares `limit_window_seconds`, and plans vary: the common shapes are 18000
// (5 h) and 604800 (7 d), a 2592000 (30 d) window has been observed, and the
// weekly window can arrive as the primary one or be missing entirely
// (aporcelli/pi-usage#2 reports the same mismatch). Label from the declared
// duration so an empty `secondary_window` cannot produce a "5 hours" bar that
// resets in days.
function codexWindowLabel(window: JsonRecord | null, positional: string): string {
  const seconds = numberValue(window?.limit_window_seconds);
  if (seconds === null || seconds <= 0) return positional;
  if (seconds % 86_400 === 0) {
    const days = seconds / 86_400;
    return days === 7 ? "Weekly" : days === 1 ? "1 day" : `${days} days`;
  }
  const hours = Math.round(seconds / 3_600);
  if (hours > 0) return hours === 1 ? "1 hour" : `${hours} hours`;
  return `${Math.max(1, Math.round(seconds / 60))} minutes`;
}

export function parseCodexUsage(payload: unknown): UsageWindow[] | null {
  const rateLimit = asRecord(asRecord(payload)?.rate_limit);
  if (rateLimit === null) return null;
  const windows: UsageWindow[] = [];
  for (const [key, label] of [["primary_window", "5 hours"], ["secondary_window", "Weekly"]] as const) {
    const window = asRecord(rateLimit[key]);
    const usedPercent = boundedPercent(window?.used_percent);
    if (usedPercent !== null) {
      windows.push({ label: codexWindowLabel(window, label), usedPercent, resetsAt: unixResetTime(window?.reset_at) });
    }
  }
  return windows.length === 0 ? null : windows;
}

export function parseOpenCodeGoUsage(payload: unknown): UsageWindow[] | null {
  const usage = asRecord(asRecord(payload)?.usage);
  if (usage === null) return null;
  const windows: UsageWindow[] = [];
  for (const [key, label] of [["rolling", "5 hours"], ["weekly", "Weekly"], ["monthly", "Monthly"]] as const) {
    const window = asRecord(usage[key]);
    const usedPercent = boundedPercent(window?.percent);
    if (usedPercent !== null) {
      windows.push({ label, usedPercent, resetsAt: resetTime(window?.resetsAt) });
    }
  }
  return windows.length === 0 ? null : windows;
}

export function parseOllamaUsage(payload: unknown): UsageWindow[] | null {
  const root = asRecord(payload);
  const included = asRecord(root?.included);
  if (included === null) return null;
  if (root?.purchased !== undefined && numberValue(asRecord(root.purchased)?.balance_usd) === null) return null;

  const balance = numberValue(included.balance_usd);
  const allowance = numberValue(included.allowance_usd);
  const hasAllowance = included.balance_usd !== undefined || included.allowance_usd !== undefined;
  if (hasAllowance && (balance === null || allowance === null)) return null;
  const period = asRecord(included.period);
  if (included.period !== undefined && (
    period === null ||
    (period.from !== undefined && typeof period.from !== "string") ||
    (period.until !== undefined && typeof period.until !== "string")
  )) return null;

  // /api/usage reports activity, not quota. Only balance windows and the
  // included billing period provide quota reset or allowance renewal dates.
  const windows: UsageWindow[] = [];
  const clamp = (used: number) => Math.round(Math.min(100, Math.max(0, used)));
  for (const [key, label] of [["session", "5 hours"], ["weekly", "Weekly"], ["monthly", "Monthly (30d)"]] as const) {
    if (included[key] === undefined) continue;
    const window = asRecord(included[key]);
    const remaining = numberValue(window?.remaining_percent);
    if (remaining === null || (window?.resets_at !== undefined && typeof window.resets_at !== "string")) return null;
    windows.push({ label, usedPercent: clamp(100 - remaining), resetsAt: resetTime(window?.resets_at) });
  }
  if (windows.length === 0 && balance !== null && allowance !== null && allowance > 0) {
    windows.push({
      label: "Included allowance",
      usedPercent: clamp(((allowance - balance) / allowance) * 100),
      resetsAt: resetTime(period?.until),
    });
  }
  return windows.length === 0 ? null : windows;
}

const SOURCES = [
  { id: "codex" as const, label: "Codex" },
  { id: "opencode-go" as const, label: "OpenCode Go" },
  { id: "ollama-cloud" as const, label: "Ollama Cloud" },
];

function unconfigured(id: UsageSource["id"], label: string): UsageSource {
  return { id, label, status: "not_configured", message: "No credential is configured.", windows: [] };
}

function unavailableSource(id: UsageSource["id"], label: string, message: string): UsageSource {
  return { id, label, status: "unavailable", message, windows: [] };
}

function errorSource(id: UsageSource["id"], label: string, message: string): UsageSource {
  return { id, label, status: "error", message, windows: [] };
}

export function unavailablePiUsage(message: string): PiUsageSnapshot {
  return { sources: SOURCES.map(({ id, label }) => errorSource(id, label, message)) };
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function fetchSource(
  id: UsageSource["id"],
  label: string,
  url: string,
  token: string,
  parse: (payload: unknown) => UsageWindow[] | null,
  fetcher: Fetcher,
  headers: Record<string, string> = {},
): Promise<UsageSource> {
  try {
    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401) {
      return { id, label, status: "expired", message: "The credential was rejected. Refresh it in Pi.", windows: [] };
    }
    if (!response.ok) return errorSource(id, label, `Usage service returned HTTP ${response.status}.`);
    const windows = parse(await response.json());
    return windows === null
      ? errorSource(id, label, "Usage service returned an unexpected response.")
      : { id, label, status: "ok", message: null, windows };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return errorSource(id, label, "Usage service returned invalid JSON.");
    }
    if (error instanceof Error && error.name === "TimeoutError") {
      return errorSource(id, label, "Usage request timed out.");
    }
    return errorSource(id, label, "Unable to load usage.");
  }
}

export async function readPiUsage(deps: UsageReaderDependencies = {}): Promise<PiUsageSnapshot> {
  const read = deps.readFile ?? readFile;
  const fetcher = deps.fetch ?? fetch;
  let credentials: Credentials;
  try {
    credentials = parseCredentials(JSON.parse(await read(deps.authPath ?? authFilePath(), "utf8")));
  } catch (error) {
    if (!isMissingFile(error)) {
      return unavailablePiUsage("Unable to read credentials.");
    }
    credentials = { codex: null, openaiOAuthConfigured: false, opencodeGo: null, ollamaCloud: null };
  }

  const codex = credentials.codex === null
    ? Promise.resolve(credentials.openaiOAuthConfigured
      ? unavailableSource("codex", "Codex", "Pi's openai sign-in (Sign in with ChatGPT) cannot read Codex plan usage. Sign in with Pi's OpenAI Codex (legacy) provider to show it here, or view usage in ChatGPT settings.")
      : unconfigured("codex", "Codex"))
    : fetchSource("codex", "Codex", CODEX_USAGE_URL, credentials.codex.access, parseCodexUsage, fetcher, {
      "ChatGPT-Account-Id": credentials.codex.accountId,
      "User-Agent": "pi-extras-bb-plugin",
    });
  const opencodeGo = credentials.opencodeGo === null
    ? Promise.resolve(unconfigured("opencode-go", "OpenCode Go"))
    : fetchSource("opencode-go", "OpenCode Go", OPENCODE_GO_USAGE_URL, credentials.opencodeGo, parseOpenCodeGoUsage, fetcher);
  const ollamaCloud = credentials.ollamaCloud === null
    ? Promise.resolve(unconfigured("ollama-cloud", "Ollama Cloud"))
    : fetchSource("ollama-cloud", "Ollama Cloud", OLLAMA_USAGE_URL, credentials.ollamaCloud, parseOllamaUsage, fetcher, {
      "User-Agent": "undici",
    });

  return { sources: await Promise.all([codex, opencodeGo, ollamaCloud]) };
}
