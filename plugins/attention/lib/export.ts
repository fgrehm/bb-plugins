import type { DaySummary } from "./contract.js";
import type { EstimateAssumptions, HumanTimeEstimate } from "./estimate.js";

export interface SummaryThread {
  title: string;
  agentMs: number;
  turns: number;
  inputs: number;
}

export interface SummaryExportInput {
  title: string;
  narrative: string;
  summary: DaySummary;
  estimate: HumanTimeEstimate;
  assumptions: EstimateAssumptions;
  threads: SummaryThread[];
  timezone: string;
  threadsScanned: number;
  eventsRead: number;
}

function duration(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes < 1) return `${Math.round(ms / 1000)}s`;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function summaryMarkdown(input: SummaryExportInput): string {
  const { summary, estimate, assumptions } = input;
  const lines: string[] = [
    `# ${input.title}`,
    "",
    input.narrative,
    "",
    `- Turns: ${summary.turns}`,
    `- Agent time: ${duration(summary.turnMinutes * 60_000)}`,
    `- Your inputs: ${summary.humanInputs} (${summary.agentInputs} agent, ${summary.systemInputs} system)`,
    `- Requests: ${summary.questions} (${summary.answeredQuestions} resolved)`,
    `- Peak running: ${summary.peakConcurrency}`,
    `- Time with 2+ running: ${summary.busyMinutes} min`,
    `- Thread switches: ${summary.threadTransitions}`,
    "",
    `Estimated human time: ~${duration(estimate.totalMs)} (${duration(
      estimate.interactingMs,
    )} interacting, ${duration(estimate.switchingMs)} switching; ${assumptions.inputSeconds}s per input, ${assumptions.requestSeconds}s per request, ${assumptions.switchSeconds}s per switch).`,
    "",
  ];

  if (input.threads.length > 0) {
    lines.push("Top threads:");
    for (const thread of input.threads) {
      lines.push(
        `- ${thread.title} — ${duration(thread.agentMs)}, ${thread.turns} turns, ${thread.inputs} inputs`,
      );
    }
    lines.push("");
  }

  lines.push(
    `Coverage: ${input.threadsScanned} threads scanned, ${input.eventsRead} events read. Times in ${input.timezone}.`,
    "",
    "Recorded activity only; not a measure of attention or productivity.",
  );
  return `${lines.join("\n")}\n`;
}
