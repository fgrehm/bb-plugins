import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";
import type { mcpServersSchema } from "./contract.js";
import { agentDir } from "./pi-trust.ts";

export type McpServers = z.infer<typeof mcpServersSchema>;

type JsonRecord = Record<string, unknown>;

/** Where Pi stores user-level MCP servers; project servers need trust. */
export function mcpConfigPath(env: NodeJS.ProcessEnv = process.env, baseDir?: string): string {
  return join(agentDir(env, baseDir), "mcp.json");
}

/** Pi accepts exactly these `type` values; legacy `sse` is rejected. */
const SERVER_TYPES = ["stdio", "http", "streamable-http"] as const;
/** Pi's exposure values; older aliases are accepted and normalized away. */
const EXPOSURES = ["codemode", "deferred", "direct", "hidden"] as const;
/** Older exposure names Pi still accepts in configs. */
const EXPOSURE_ALIASES: Readonly<Record<string, (typeof EXPOSURES)[number]>> = { "codemode-deferred": "codemode" };

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is JsonRecord {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function resolveExposureAlias(value: unknown): unknown {
  return typeof value === "string" ? EXPOSURE_ALIASES[value] ?? value : value;
}

function isExposure(value: unknown): boolean {
  return resolveExposureAlias(value) !== undefined && EXPOSURES.includes(resolveExposureAlias(value) as (typeof EXPOSURES)[number]);
}

/** Pi's server name rule: letters, digits, underscore, dash. */
const SERVER_NAME = /^[A-Za-z0-9_-]+$/;

type ServerSummary = z.infer<typeof mcpServersSchema>["servers"][number];

/**
 * A port of Pi's `validateMcpServerConfig` (packages/coding-agent/src/core/
 * mcp-servers.ts) to the fields the panel presents. Returns the summary or a
 * Pi-shaped error string. OAuth and project-scope `auth` rules are not modeled;
 * a server that only fails those rarer checks is shown as configured.
 */
export function validateMcpServer(
  name: string,
  raw: unknown,
): { ok: true; server: ServerSummary } | { ok: false; reason: string } {
  if (!SERVER_NAME.test(name)) {
    return { ok: false, reason: `invalid server name "${name}" (use letters, digits, "_" and "-")` };
  }
  if (!isRecord(raw)) return { ok: false, reason: `server "${name}" must be an object` };
  // The legacy-SSE diagnostic comes first, before the generic type guard.
  if (raw.type === "sse") {
    return { ok: false, reason: `server "${name}": legacy SSE transport is not supported; use the streamable HTTP URL` };
  }
  // A present type must be exactly one of pi's supported names; arbitrary values
  // are rejected rather than treated like an omitted type.
  if (typeof raw.type !== "undefined" && (typeof raw.type !== "string" || !SERVER_TYPES.includes(raw.type as (typeof SERVER_TYPES)[number]))) {
    return { ok: false, reason: `server "${name}": unsupported type "${String(raw.type)}"` };
  }
  const value = raw;
  const type = typeof raw.type === "string" ? raw.type : undefined;
  const { exposure, enabled, timeout, toolExposure, description } = value;
  if (exposure !== undefined && typeof exposure !== "string" || exposure !== undefined && !isExposure(exposure)) {
    return { ok: false, reason: `server "${name}": exposure must be one of "codemode", "deferred", "direct", "hidden"` };
  }
  if (toolExposure !== undefined) {
    if (!isRecord(toolExposure)) return { ok: false, reason: `server "${name}": toolExposure must map tool names to exposures` };
    for (const [tool, entry] of Object.entries(toolExposure)) {
      if (!isExposure(entry)) return { ok: false, reason: `server "${name}": toolExposure "${tool}" must be one of "codemode", "deferred", "direct", "hidden"` };
    }
  }
  if (enabled !== undefined && typeof enabled !== "boolean") {
    return { ok: false, reason: `server "${name}": enabled must be a boolean` };
  }
  if (description !== undefined && typeof description !== "string") {
    return { ok: false, reason: `server "${name}": description must be a string` };
  }
  if (timeout !== undefined && (typeof timeout !== "number" || !(timeout > 0))) {
    return { ok: false, reason: `server "${name}": timeout must be a positive number of seconds` };
  }

  // Pi branches on the url first when the type admits one, then on the command
  // branch with the exact same shape Pi's validateMcpServerConfig uses.
  if (typeof value.url === "string" && (type === undefined || type === "http" || type === "streamable-http")) {
    if (!URL.canParse(value.url) || !/^https?:$/.test(new URL(value.url).protocol)) {
      return { ok: false, reason: `server "${name}": url must be an http or https URL` };
    }
    if (value.headers !== undefined && !isStringRecord(value.headers)) {
      return { ok: false, reason: `server "${name}": headers must map names to strings` };
    }
    return { ok: true, server: { name, level: "user", transport: "http", detail: value.url } };
  }
  if (typeof value.command === "string" && (type === undefined || type === "stdio")) {
    if (value.args !== undefined && !(Array.isArray(value.args) && value.args.every((arg) => typeof arg === "string"))) {
      return { ok: false, reason: `server "${name}": args must be an array of strings` };
    }
    if (value.env !== undefined && !isStringRecord(value.env)) {
      return { ok: false, reason: `server "${name}": env must map names to strings` };
    }
    if (value.cwd !== undefined && typeof value.cwd !== "string") {
      return { ok: false, reason: `server "${name}": cwd must be a string` };
    }
    const args = Array.isArray(value.args) ? value.args : [];
    return {
      ok: true,
      // Environment values are never surfaced; only the launch shape is shown.
      server: { name, level: "user", transport: "stdio", detail: `${value.command}${args.length > 0 ? ` ${args.join(" ")}` : ""}`.trim() },
    };
  }
  return { ok: false, reason: `server "${name}" needs either "command" (stdio) or "url" (streamable HTTP)` };
}

/**
 * A read-only summary of Pi's user-level MCP config. Project servers are not
 * read: they apply only after trust, and the trust panel already frames what a
 * trusted workspace will load. Nothing here is ever written; `pi mcp add` owns
 * the file. Malformed entries are reported in `invalid` rather than shown as
 * usable rows, and environment values are never surfaced.
 */
export async function readMcpServers(env: NodeJS.ProcessEnv = process.env, baseDir?: string): Promise<McpServers> {
  const path = mcpConfigPath(env, baseDir);
  const empty: McpServers = { servers: [], autoEnableCodemode: null, path, error: null, invalid: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (cause) {
    // A missing file only means the user added no servers yet.
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return empty;
    return {
      servers: [],
      autoEnableCodemode: null,
      path,
      error: cause instanceof Error ? `Cannot read ${path}: ${(cause as NodeJS.ErrnoException).code ?? cause.message}` : String(cause),
      invalid: [],
    };
  }
  if (!isRecord(raw) || (raw.mcpServers !== undefined && !isRecord(raw.mcpServers))) {
    return { ...empty, error: "mcp.json must be an object with an mcpServers object; pi ignores it until it is fixed." };
  }
  const servers: ServerSummary[] = [];
  const invalid: string[] = [];
  for (const [name, value] of Object.entries((raw.mcpServers as JsonRecord | undefined) ?? {})) {
    const validated = validateMcpServer(name, value);
    if (validated.ok) servers.push(validated.server);
    else invalid.push(validated.reason);
  }
  return {
    servers,
    autoEnableCodemode: typeof raw.autoEnableCodemode === "boolean" ? raw.autoEnableCodemode : null,
    path,
    error: null,
    invalid,
  };
}