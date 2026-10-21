import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const DAY_INPUT = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const initiatorSchema = z.enum(["user", "agent", "system", "unknown"]);
const inputKindSchema = z.enum(["new-turn", "steer", "auto", "thread-start"]);
const turnStatusSchema = z.enum([
  "completed",
  "failed",
  "interrupted",
  "running",
  "unknown",
]);
const questionOutcomeSchema = z.enum([
  "answered",
  "timeout",
  "dismissed",
  "interrupted",
  "open",
]);

export const dayThreadSchema = z.object({
  id: z.string(),
  title: z.string(),
  projectId: z.string(),
  providerId: z.string(),
  parentThreadId: z.string().nullable(),
  archived: z.boolean(),
  createdAt: z.number(),
});
export type DayThread = z.infer<typeof dayThreadSchema>;

export const dayTurnSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  start: z.number(),
  end: z.number(),
  status: turnStatusSchema,
  initiator: initiatorSchema,
  kind: inputKindSchema.nullable(),
  model: z.string().nullable(),
});
export type DayTurn = z.infer<typeof dayTurnSchema>;

export const dayInputSchema = z.object({
  threadId: z.string(),
  at: z.number(),
  kind: inputKindSchema,
  initiator: initiatorSchema,
  model: z.string().nullable(),
  queueDelayMs: z.number().nullable(),
});
export type DayInput = z.infer<typeof dayInputSchema>;

export const dayQuestionSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  opened: z.number(),
  resolved: z.number().nullable(),
  title: z.string(),
  outcome: questionOutcomeSchema,
  waitMs: z.number().nullable(),
});
export type DayQuestion = z.infer<typeof dayQuestionSchema>;

export const daySummarySchema = z.object({
  threadsActive: z.number().int(),
  turns: z.number().int(),
  turnMinutes: z.number(),
  humanInputs: z.number().int(),
  agentInputs: z.number().int(),
  systemInputs: z.number().int(),
  questions: z.number().int(),
  answeredQuestions: z.number().int(),
  peakConcurrency: z.number().int(),
  busyMinutes: z.number().int(),
  threadTransitions: z.number().int(),
});
export type DaySummary = z.infer<typeof daySummarySchema>;

export const dayBinSchema = z.object({
  binMs: z.number().int(),
  concurrency: z.array(z.number().int()),
  humanInputs: z.array(z.number().int()),
});

export const dayCoverageSchema = z.object({
  threadsScanned: z.number().int(),
  eventsRead: z.number().int(),
  truncatedThreads: z.array(z.string()),
});

export const dayReportSchema = z.object({
  day: z.string(),
  timezone: z.string(),
  dayStart: z.number(),
  dayEnd: z.number(),
  generatedAt: z.number(),
  threads: z.array(dayThreadSchema),
  turns: z.array(dayTurnSchema),
  inputs: z.array(dayInputSchema),
  questions: z.array(dayQuestionSchema),
  summary: daySummarySchema,
  bins: dayBinSchema,
  coverage: dayCoverageSchema,
});
export type DayReport = z.infer<typeof dayReportSchema>;

export const readDayInputSchema = z.object({
  day: DAY_INPUT,
  timezone: z.string().min(1).max(64),
  projectId: z.string().min(1).optional(),
  includeHidden: z.boolean().optional(),
});
export type ReadDayInput = z.infer<typeof readDayInputSchema>;

export const rpcContract = defineRpcContract({
  read_day: {
    input: readDayInputSchema,
    output: dayReportSchema,
  },
});
