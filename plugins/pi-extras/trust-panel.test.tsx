import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrustCheck } from "./trust-types";

const rpc = vi.hoisted(() => ({ call: vi.fn() }));
const keyed = vi.hoisted(() => ({
  result: { data: undefined as unknown, refetch: vi.fn() },
  keys: [] as Array<readonly string[]>,
}));
const sidebar = vi.hoisted(() => ({
  threads: [] as Array<{ id: string; providerId: string; environment: { path: string | null } | null }>,
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => rpc,
  useRealtime: () => undefined,
  experimental_useSidebarThreads: () => ({ threads: sidebar.threads }),
  experimental_useRpcKeyedQuery: (options: { keys: readonly string[] }) => {
    keyed.keys.push(options.keys);
    return keyed.result;
  },
}));

const {
  PiTrustBadge,
  PiTrustPanel,
  PiTrustSegmentDetails,
  PiTrustSegmentSummary,
  usePiTrustSegmentVisible,
} = await import("./trust-panel");

function check(overrides: Partial<TrustCheck> = {}): TrustCheck {
  return {
    path: "/repo",
    hostId: "host-1",
    storePath: "/home/tester/.pi/agent/trust.json",
    canonicalPath: "/repo",
    resources: ["/repo/.pi/skills", "/repo/.agents/skills"],
    savedDecision: null,
    savedDecisionPath: null,
    defaultProjectTrust: "ask",
    trusted: false,
    status: "untrusted",
    canTrust: true,
    error: null,
    ...overrides,
  };
}

const PI_THREAD = {
  id: "th_1",
  providerId: "pi",
  environment: { path: "/repo" },
};

function load(data: Record<string, TrustCheck> | undefined) {
  keyed.result = { data, refetch: vi.fn() };
}

describe("PiTrustBadge", () => {
  afterEach(cleanup);

  it("marks only an untrusted Pi thread", () => {
    load({ th_1: check() });
    render(<PiTrustBadge thread={PI_THREAD as never} data={{ th_1: check() }} />);
    expect(screen.getByText("untrusted")).not.toBeNull();
  });

  it("renders nothing for a trusted workspace, another provider, or no data", () => {
    load(undefined);
    const { container, rerender } = render(
      <PiTrustBadge thread={PI_THREAD as never} data={{ th_1: check({ trusted: true, status: "trusted" }) }} />,
    );
    expect(container.textContent).toBe("");
    rerender(<PiTrustBadge thread={{ ...PI_THREAD, providerId: "codex" } as never} data={{ th_1: check() }} />);
    expect(container.textContent).toBe("");
    rerender(<PiTrustBadge thread={PI_THREAD as never} data={{}} />);
    expect(container.textContent).toBe("");
  });
});

describe("PiTrustSegment", () => {
  afterEach(() => {
    cleanup();
    sidebar.threads = [];
  });

  it("shows only for a Pi thread with a workspace Pi skipped", () => {
    sidebar.threads = [
      { id: "th_1", providerId: "pi", environment: { path: "/repo" } },
      { id: "th_2", providerId: "codex", environment: { path: "/repo" } },
    ];
    load({ th_1: check(), th_2: check() });
    const input = { threadId: "th_1", projectId: "p", environment: { id: "env" }, segments: [], isExpanded: false, onToggle: () => {} };
    expect(renderHook(() => usePiTrustSegmentVisible(input)).result.current).toBe(true);
    expect(
      renderHook(() => usePiTrustSegmentVisible({ ...input, threadId: "th_2" })).result.current,
    ).toBe(false);
    // A non-Pi thread must not send its id to the host.
    expect(keyed.keys.at(-1)).toEqual([]);
  });

  it("hides for a trusted workspace or before the check returns", () => {
    sidebar.threads = [{ id: "th_1", providerId: "pi", environment: { path: "/repo" } }];
    const input = { threadId: "th_1", projectId: "p", environment: { id: "env" }, segments: [], isExpanded: false, onToggle: () => {} };
    load({});
    expect(renderHook(() => usePiTrustSegmentVisible(input)).result.current).toBe(false);
    load({ th_1: check({ trusted: true, status: "trusted" }) });
    expect(renderHook(() => usePiTrustSegmentVisible(input)).result.current).toBe(false);
  });

  it("summarizes the skipped count and toggles the details", () => {
    load({ th_1: check() });
    const onToggle = vi.fn();
    render(
      <PiTrustSegmentSummary
        threadId="th_1"
        projectId="p"
        environment={{ id: "env" }}
        segments={[]}
        isExpanded={false}
        onToggle={onToggle}
      />,
    );
    const button = screen.getByRole("button", { name: /2 resources skipped/ });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalled();
  });

  it("renders nothing in the row for a trusted workspace", () => {
    load({ th_1: check({ trusted: true, status: "trusted" }) });
    const { container } = render(
      <PiTrustSegmentSummary
        threadId="th_1"
        projectId="p"
        environment={{ id: "env" }}
        segments={[]}
        isExpanded={false}
        onToggle={() => {}}
      />,
    );
    expect(container.textContent).toBe("");
  });
});

describe("PiTrustPanel", () => {
  afterEach(() => {
    cleanup();
    rpc.call.mockReset();
  });

  it("shows the skipped resources and writes only when the button is pressed", async () => {
    load({ th_1: check() });
    rpc.call.mockResolvedValue(check({ trusted: true, status: "trusted", canTrust: false }));
    render(<PiTrustPanel threadId="th_1" />);

    expect(screen.getByText("Pi would skip project resources")).not.toBeNull();
    expect(screen.getByText("/repo/.pi/skills")).not.toBeNull();
    expect(screen.getByText("/repo/.agents/skills")).not.toBeNull();
    expect(rpc.call).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Trust /repo for Pi" }));
    await waitFor(() =>
      expect(rpc.call).toHaveBeenCalledWith("trustThreadWorkspace", {
        threadId: "th_1",
        confirm: true,
        workspace: { hostId: "host-1", canonicalPath: "/repo" },
      }),
    );
  });

  it("refreshes through the cache-bypassing RPC", async () => {
    load({ th_1: check() });
    rpc.call.mockResolvedValue(check());
    render(<PiTrustPanel threadId="th_1" />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(rpc.call).toHaveBeenCalledWith("refreshThreadTrust", { threadId: "th_1" }));
  });

  it("reports a failed refresh instead of silently keeping the old answer", async () => {
    load({ th_1: check() });
    rpc.call.mockRejectedValue(new Error("host is offline"));
    render(<PiTrustPanel threadId="th_1" />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("host is offline"));
  });

  it("offers no button when the workspace is already trusted", () => {
    load({ th_1: check({ trusted: true, status: "trusted", canTrust: false }) });
    render(<PiTrustPanel threadId="th_1" />);
    expect(screen.getByText("This workspace is trusted for Pi")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^Trust / })).toBeNull();
  });

  it("says a bare .pi directory needs no decision", () => {
    load({ th_1: check({ resources: [], trusted: true, status: "no-resources", canTrust: false }) });
    render(<PiTrustPanel threadId="th_1" />);
    expect(screen.getByText(/gates nothing in this workspace/)).not.toBeNull();
  });

  it("opens the same panel from the composer segment, before any write", async () => {
    load({ th_1: check() });
    render(<PiTrustSegmentDetails threadId="th_1" isExpanded segments={[]} onToggle={() => {}} projectId="p" environment={null} />);
    expect(screen.getByText("/repo/.pi/skills")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Trust /repo for Pi" })).not.toBeNull();
    expect(rpc.call).not.toHaveBeenCalled();
  });

  it("surfaces a save failure without claiming the decision was saved", async () => {
    load({ th_1: check() });
    rpc.call.mockRejectedValue(new Error("Pi's trust store is unreadable"));
    render(<PiTrustPanel threadId="th_1" />);
    fireEvent.click(screen.getByRole("button", { name: "Trust /repo for Pi" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("unreadable"));
    expect(screen.getByRole("button", { name: "Trust /repo for Pi" })).not.toBeNull();
  });
});
