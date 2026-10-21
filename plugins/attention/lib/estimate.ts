export interface EstimateAssumptions {
  inputSeconds: number;
  requestSeconds: number;
  switchSeconds: number;
}

export interface EstimateCounts {
  inputs: number;
  requests: number;
  switches: number;
}

export interface HumanTimeEstimate {
  interactingMs: number;
  switchingMs: number;
  totalMs: number;
}

export const DEFAULT_ASSUMPTIONS: EstimateAssumptions = {
  inputSeconds: 20,
  requestSeconds: 60,
  switchSeconds: 30,
};

function seconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function estimateHumanTime(
  counts: EstimateCounts,
  assumptions: EstimateAssumptions,
): HumanTimeEstimate {
  const interactingMs =
    (Math.max(0, counts.inputs) * seconds(assumptions.inputSeconds) +
      Math.max(0, counts.requests) * seconds(assumptions.requestSeconds)) *
    1000;
  const switchingMs =
    Math.max(0, counts.switches) * seconds(assumptions.switchSeconds) * 1000;
  return {
    interactingMs,
    switchingMs,
    totalMs: interactingMs + switchingMs,
  };
}

export function clampAssumptions(
  assumptions: EstimateAssumptions,
): EstimateAssumptions {
  const bounded = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, Math.round(seconds(value))));
  return {
    inputSeconds: bounded(assumptions.inputSeconds, 0, 300),
    requestSeconds: bounded(assumptions.requestSeconds, 0, 600),
    switchSeconds: bounded(assumptions.switchSeconds, 0, 600),
  };
}
