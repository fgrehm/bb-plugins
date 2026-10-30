import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const usageWindowSchema = z.object({
  label: z.string(),
  usedPercent: z.number().min(0).max(100),
  resetsAt: z.string().nullable(),
}).strict();

const piModelSchema = z.object({
  provider: z.string(),
  id: z.string(),
  name: z.string().nullable(),
  contextWindow: z.number().nullable(),
  maxTokens: z.number().nullable(),
  reasoning: z.boolean(),
  images: z.boolean(),
}).strict();

const modelListSchema = z.object({
  models: z.array(piModelSchema),
  error: z.string().nullable(),
}).strict();

const nullableFlag = z.boolean().nullable();
const nullableCount = z.number().int().nonnegative().nullable();

/**
 * Every field is nullable, and null means the key is absent from settings.json so
 * Pi applies its own default. The panel shows Pi's documented default as a
 * placeholder rather than writing it out.
 *
 * These are the global settings BB does not pass when it starts a thread, so
 * Pi's values are what a BB thread runs with. BB passes model, reasoning level,
 * instructions, and session directory itself, and it does its own message
 * queueing, which is why the rest of Pi's global surface is left alone.
 */
const piSettingsSchema = z.object({
  defaultProvider: z.string().nullable(),
  defaultModel: z.string().nullable(),
  defaultThinkingLevel: z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]).nullable(),
  enabledModels: z.array(z.string()),
  compaction: z.object({
    enabled: nullableFlag,
    reserveTokens: nullableCount,
    keepRecentTokens: nullableCount,
  }).strict(),
  httpIdleTimeoutMs: nullableCount,
  shell: z.object({
    shellPath: z.string().nullable(),
    shellCommandPrefix: z.string().nullable(),
  }).strict(),
  telemetry: z.object({
    enableInstallTelemetry: nullableFlag,
    enableAnalytics: nullableFlag,
  }).strict(),
}).strict();

const updateSchema = z.object({ target: z.enum(["models", "plugins", "pinned"]) }).strict();

const usageSourceSchema = z.object({
  id: z.enum(["codex", "opencode-go", "ollama-cloud"]),
  label: z.string(),
  status: z.enum(["ok", "not_configured", "unavailable", "expired", "error"]),
  message: z.string().nullable(),
  windows: z.array(usageWindowSchema),
}).strict();

const textResultSchema = z.object({ text: z.string().min(1) }).strict();

const titleServiceStatusSchema = z.discriminatedUnion("ready", [
  z.object({ ready: z.literal(true) }).strict(),
  z.object({ ready: z.literal(false), message: z.string().min(1) }).strict(),
]);

const titleSettingsSchema = z
  .object({ titleModel: z.string(), commitModel: z.string() })
  .strict();

/**
 * One workspace's Pi project-trust state. `resources` is bounded by Pi's own
 * eight gated `.pi` entries plus the `.agents/skills` directories between the
 * workspace and the filesystem root, so this stays small on the wire.
 */
const trustCheckSchema = z.object({
  path: z.string(),
  hostId: z.string().nullable(),
  storePath: z.string(),
  canonicalPath: z.string(),
  resources: z.array(z.string()),
  savedDecision: z.boolean().nullable(),
  savedDecisionPath: z.string().nullable(),
  defaultProjectTrust: z.enum(["ask", "always", "never"]),
  trusted: z.boolean(),
  status: z.enum(["trusted", "untrusted", "no-resources", "unknown"]),
  canTrust: z.boolean(),
  error: z.string().nullable(),
}).strict();

export const piExtrasHostContract = defineRpcContract({
  readUsage: {
    input: z.object({}).strict(),
    output: z.object({ sources: z.array(usageSourceSchema) }).strict(),
  },
  readSettings: { input: z.object({}).strict(), output: piSettingsSchema },
  writeSettings: { input: piSettingsSchema, output: piSettingsSchema },
  update: { input: updateSchema, output: z.object({ ok: z.boolean(), output: z.string() }).strict() },
  listModels: { input: z.object({}).strict(), output: modelListSchema },
  /**
   * One bb text-completion prompt, answered by pi on the host that has pi
   * installed. `model` is a `provider/id`, or null to use pi's own default.
   */
  generateText: {
    input: z.object({ prompt: z.string().min(1), model: z.string().nullable() }).strict(),
    output: textResultSchema,
  },
  /** Whether pi can answer at all, for the AI services picker. */
  probeTitleService: {
    input: z.object({}).strict(),
    output: titleServiceStatusSchema,
  },
  /** Read-only project-trust report for workspaces on this host. */
  readTrustChecks: {
    input: z.object({ paths: z.array(z.string()).max(200), force: z.boolean().optional() }).strict(),
    output: z.object({ checks: z.record(z.string(), trustCheckSchema) }).strict(),
  },
  /**
   * Saves Pi's trust decision for one workspace, exactly as `pi /trust` does.
   * `confirm` must be the literal `true`, so no caller writes without an
   * explicit user action behind it.
   */
  saveTrustDecision: {
    input: z.object({
      path: z.string(),
      confirm: z.literal(true),
      /** The canonical directory the user saw; a changed target rejects the write. */
      expectedCanonicalPath: z.string(),
    }).strict(),
    output: trustCheckSchema,
  },
});

export const piExtrasRpcContract = defineRpcContract({
  refreshUsage: {
    input: z.object({ force: z.boolean().optional() }).strict(),
    output: z.object({
      hostName: z.string().nullable(),
      sources: z.array(usageSourceSchema),
    }).strict(),
  },
  readSettings: { input: z.object({}).strict(), output: piSettingsSchema },
  writeSettings: { input: piSettingsSchema, output: piSettingsSchema },
  update: { input: updateSchema, output: z.object({ ok: z.boolean(), output: z.string() }).strict() },
  listModels: {
    input: z.object({ force: z.boolean().optional() }).strict(),
    output: modelListSchema,
  },
  /** Per-task text models; an empty commit model falls back to the title model. */
  readTitleSettings: { input: z.object({}).strict(), output: titleSettingsSchema },
  writeTitleSettings: { input: titleSettingsSchema, output: titleSettingsSchema },
  /** The same cached readiness answer the AI services picker receives. */
  titleServiceStatus: { input: z.object({}).strict(), output: titleServiceStatusSchema },
  /**
   * Per-thread Pi trust state, keyed by thread id so the sidebar badge and the
   * thread's trust panel share one read. A thread without a Pi environment path
   * reports `unknown` rather than failing the batch.
   */
  threadTrustChecks: {
    input: z.object({ keys: z.array(z.string()).max(1000) }).strict(),
    output: z.record(z.string(), trustCheckSchema),
  },
  /** Re-reads one thread's trust state, bypassing server and host caches. */
  refreshThreadTrust: {
    input: z.object({ threadId: z.string() }).strict(),
    output: trustCheckSchema,
  },
  /** Saves Pi's trust decision for the thread's workspace; never called on read. */
  trustThreadWorkspace: {
    input: z.object({
      threadId: z.string(),
      confirm: z.literal(true),
      /** The workspace the user saw on the button; re-resolved before writing. */
      workspace: z.object({ hostId: z.string(), canonicalPath: z.string() }).strict(),
    }).strict(),
    output: trustCheckSchema,
  },
});
