// @vitest-environment jsdom
Element.prototype.scrollIntoView =
  Element.prototype.scrollIntoView ?? (() => {});
// Review Workspace behaves as the mobile-viewport experience at/near jsdom's
// zero-width viewport: the compose sheet, the file-navigation popover and the
// bottom bar all target <= Tailwind's lg breakpoint.
if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("max-width: 1023px"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

afterEach(cleanup);

// The mobile file-navigation popover labels every row "Open <path>".
function openedFileRow(slot: any, path: string) {
  return slot.getByRole("button", { name: `Open ${path}` });
}

vi.mock("@/components/ui/icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: (props: any) => (
    <>
      <div
        data-testid="pierre-diff"
        data-expand-unchanged={String(props.options.expandUnchanged)}
        data-hunk-separators={props.options.hunkSeparators}
        data-line-diff-type={props.options.lineDiffType}
        data-diff-style={props.options.diffStyle}
      />
      <div
        onPointerUp={() =>
          props.options.onLineSelectionEnd?.({
            start: 1,
            end: 1,
            side: "additions",
          })
        }
      >
        {(props.lineAnnotations ?? []).map((la: any, index: number) => (
          <div key={`${la.lineNumber}-${index}`} data-line={la.lineNumber}>
            {la.metadata && "id" in la.metadata ? (
              <div data-annotation-id={la.metadata.id} />
            ) : null}
            {props.renderAnnotation?.(la)}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => void props.options.loadDiffFiles?.({})}
      >
        Load context
      </button>
    </>
  ),
}));

const patch = `diff --git a/src/example.ts b/src/example.ts
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,3 +1,3 @@
 context
-old
+new
 context
`;

function reviewFixture() {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    threadId: "thread-ui",
    snapshot: "snapshot-ui",
    createdAt: 1,
    target: { type: "uncommitted" },
    files: [
      {
        path: "src/example.ts",
        previousPath: null,
        status: "modified",
        additions: 1,
        deletions: 1,
        binary: false,
        patch,
        truncated: false,
      },
    ],
    annotations: [],
    viewedPaths: [],
    summary: null,
  };
}

describe("Review Workspace app", () => {
  it("registers the header control and navigates to the review panel", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(app.threadHeaderActions[0]!, {
      threadId: "thread-ui",
      projectId: "project-ui",
      isCompactViewport: false,
    });

    slot.getByRole("button", { name: "Review" }).click();
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "review",
      options: { subPath: "review/thread-ui" },
    });

    const Header = app.threadHeaderActions[0]!.component;
    slot.rerender(
      <Header threadId="thread-ui" projectId="project-ui" isCompactViewport />,
    );
    expect(slot.queryByRole("button", { name: "Review" })).toBeNull();
    slot.lifecycle.unmount();
  });

  it("mounts file diffs lazily as they approach the viewport", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const base = reviewFixture();
    const review = {
      ...base,
      files: [
        ...base.files,
        {
          ...base.files[0]!,
          path: "docs/guide.md",
          patch: patch.replaceAll("src/example.ts", "docs/guide.md"),
        },
      ],
    };
    // jsdom has no IntersectionObserver, so without this stub every surface
    // mounts at once. Tracking it here keeps the lazy behavior honest.
    const observed: Array<{
      node: Element;
      trigger: () => void;
      disconnected: () => boolean;
    }> = [];
    class FakeIntersectionObserver {
      private callback: IntersectionObserverCallback;
      private targets = new Set<Element>();
      private stopped = false;
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }
      observe(node: Element) {
        this.targets.add(node);
        observed.push({
          node,
          trigger: () =>
            this.callback(
              [
                {
                  isIntersecting: true,
                  target: node,
                } as unknown as IntersectionObserverEntry,
              ],
              this as unknown as IntersectionObserver,
            ),
          disconnected: () => this.stopped,
        });
      }
      disconnect() {
        this.stopped = true;
        this.targets.clear();
      }
      unobserve(node: Element) {
        this.targets.delete(node);
      }
    }
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    try {
      const slot = renderSlot(
        app.navPanels[0]!,
        { subPath: "review/thread-ui" },
        {
          rpc: {
            review: () => ({ review }),
            revisions: () => ({ revisions: [] }),
          } as any,
        },
      );
      await slot.findByRole("navigation", { name: "Changed files" });
      // Both file sections exist, but neither diff is parsed or rendered yet.
      expect(
        slot.container.querySelectorAll("[data-review-file]"),
      ).toHaveLength(2);
      expect(slot.queryAllByTestId("pierre-diff")).toHaveLength(0);
      expect(
        slot.getAllByText("Diff renders as it scrolls into view."),
      ).toHaveLength(2);
      expect(observed).toHaveLength(2);

      observed[0]!.trigger();
      await vi.waitFor(() =>
        expect(slot.queryAllByTestId("pierre-diff")).toHaveLength(1),
      );
      const sections = slot.container.querySelectorAll("[data-review-file]");
      expect(
        within(sections[0] as HTMLElement).getAllByTestId("pierre-diff"),
      ).toHaveLength(1);
      expect(
        within(sections[1] as HTMLElement).queryAllByTestId("pierre-diff"),
      ).toHaveLength(0);
      expect(observed[0]!.disconnected()).toBe(true);
      expect(observed[1]!.disconnected()).toBe(false);

      // Viewing state and collapse stay independent of laziness.
      observed[1]!.trigger();
      await vi.waitFor(() =>
        expect(slot.queryAllByTestId("pierre-diff")).toHaveLength(2),
      );
      slot.lifecycle.unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("collapses a file after marking it viewed and preserves viewed state when expanded", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        rpc: {
          review: () => ({ review: reviewFixture() }),
          revisions: () => ({ revisions: [] }),
          markFileViewed: () => ({ viewedCount: 1 }),
        } as any,
      },
    );
    await slot.findByRole("navigation", { name: "Changed files" });
    const section = slot.container.querySelector(
      '[data-review-file="src/example.ts"]',
    )!;
    fireEvent.click(
      within(section as HTMLElement).getByRole("button", {
        name: "Mark viewed",
      }),
    );
    await vi.waitFor(() =>
      expect(
        within(section as HTMLElement).queryByTestId("pierre-diff"),
      ).toBeNull(),
    );
    expect(
      within(section as HTMLElement).getByText(
        "Diff collapsed. Expand to review the changes.",
      ),
    ).toBeTruthy();
    expect(
      within(section as HTMLElement)
        .getByRole("button", { name: "Viewed ✓" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(
      within(section as HTMLElement).getByRole("button", {
        name: "Expand src/example.ts",
      }),
    );
    expect(
      within(section as HTMLElement).getByTestId("pierre-diff"),
    ).toBeTruthy();
    expect(
      within(section as HTMLElement)
        .getByRole("button", { name: "Viewed ✓" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    slot.lifecycle.unmount();
  });

  it("scrolls the mobile review document to the next file below its sticky toolbar", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const base = reviewFixture();
    const review = {
      ...base,
      files: [
        ...base.files,
        {
          ...base.files[0]!,
          path: "docs/guide.md",
          patch: patch.replaceAll("src/example.ts", "docs/guide.md"),
        },
      ],
    };
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        rpc: {
          review: () => ({ review }),
          revisions: () => ({ revisions: [] }),
          markFileViewed: () => ({ viewedCount: 1 }),
        } as any,
      },
    );
    await slot.findByLabelText("Changed file", {
      exact: true,
    });
    // The file-navigation rows only become accessible once opened.
    fireEvent.click(slot.getByLabelText("Changed file", { exact: true }));
    const container = slot.getByRole("region", { name: "Review document" });
    const nextSection = slot.container.querySelector(
      '[data-review-file="docs/guide.md"]',
    )!;
    const scrollTo = vi.fn();
    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      value: 20,
    });
    Object.defineProperty(container, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });
    container.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    nextSection.getBoundingClientRect = () => ({ top: 500 }) as DOMRect;
    const sticky = container.querySelector<HTMLElement>(".sticky")!;
    Object.defineProperty(sticky, "offsetHeight", {
      configurable: true,
      value: 40,
    });

    fireEvent.click(slot.getByRole("button", { name: "Viewed & next" }));
    await vi.waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({ top: 380, behavior: "auto" });
    });
    // Choosing a file closes the sheet, so reopen it to read the current file.
    fireEvent.click(slot.getByLabelText("Changed file", { exact: true }));
    await vi.waitFor(() => {
      expect(
        openedFileRow(slot, "docs/guide.md").getAttribute("aria-current"),
      ).toBe("true");
    });
    slot.lifecycle.unmount();
  });

  it("keeps a continuous document and saves inline feedback against the selected file rather than stale active navigation", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const base = reviewFixture();
    const review = {
      ...base,
      files: [
        ...base.files,
        {
          ...base.files[0]!,
          path: "docs/guide.md",
          patch: patch.replaceAll("src/example.ts", "docs/guide.md"),
        },
      ],
    };
    const calls: any[] = [];
    const viewed: any[] = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        rpc: {
          review: () => ({ review }),
          revisions: () => ({ revisions: [] }),
          markFileViewed: (input: any) => {
            viewed.push(input);
            return { viewedCount: 1 };
          },
          addAnnotation: (input: any) => {
            calls.push(input);
            return {
              annotation: {
                ...input,
                id: "saved-inline",
                createdAt: 1,
                sentAt: null,
                resolvedAt: null,
                author: "human",
                parentId: null,
                fileLevel: false,
                carriedFromAnnotationId: null,
                resolutionSuggestion: null,
              },
            };
          },
        } as any,
      },
    );
    await slot.findByRole("navigation", { name: "Changed files" });
    expect(slot.getAllByTestId("pierre-diff")).toHaveLength(2);
    const docs = slot.container.querySelector(
      '[data-review-file="docs/guide.md"]',
    )!;
    fireEvent.pointerUp(
      within(docs as HTMLElement).getByTestId("pierre-diff")
        .nextElementSibling!,
    );
    const box = (
      await slot.findAllByLabelText("Comment", { exact: true })
    ).find((node) => node === document.activeElement)!;
    fireEvent.change(box, {
      target: { value: "Keep the guide wording precise." },
    });
    // Dismiss the compose sheet; a non-empty draft stays anchored.
    fireEvent.pointerDown(slot.container);
    await vi.waitFor(() => {
      expect(
        slot.queryByRole("dialog", { name: "Comment composer" }),
      ).toBeNull();
    });
    // Another navigation action must not change the draft's immutable anchor.
    // A non-empty dismissed draft stays recoverable through the banner.
    expect(slot.getByRole("button", { name: "Resume draft" })).toBeTruthy();
    fireEvent.click(
      within(slot.getByRole("navigation", { name: "Changed files" })).getByRole(
        "button",
        { name: "src/example.ts" },
      ),
    );
    const retained = slot.getAllByLabelText("Comment", { exact: true })[0]!;
    expect((retained as HTMLTextAreaElement).value).toBe(
      "Keep the guide wording precise.",
    );
    fireEvent.keyDown(retained, { key: "Enter", ctrlKey: true });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      filePath: "docs/guide.md",
      side: "new",
      startLine: 1,
      endLine: 1,
      body: "Keep the guide wording precise.",
    });
    expect(slot.getAllByTestId("pierre-diff")).toHaveLength(2);
    expect(viewed).toEqual([]);
    fireEvent.click(
      within(docs as HTMLElement).getByRole("button", {
        name: "Collapse docs/guide.md",
      }),
    );
    expect(within(docs as HTMLElement).queryByTestId("pierre-diff")).toBeNull();
    expect(viewed).toEqual([]);
    fireEvent.click(
      within(docs as HTMLElement).getByRole("button", {
        name: "Comment on file",
      }),
    );
    expect(within(docs as HTMLElement).getByTestId("pierre-diff")).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("preserves code and whole-file drafts when switching reading modes", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const base = reviewFixture();
    const anchor = {
      filePath: "src/example.ts",
      side: "new",
      startLine: 2,
      endLine: 2,
      valid: true,
      reason: null,
    };
    const review = {
      ...base,
      tour: {
        reviewId: base.id,
        title: "Tour",
        overview: null,
        createdAt: 1,
        steps: [
          {
            id: "draft",
            title: "Section",
            anchors: [anchor],
            blocks: [
              { kind: "narrative", body: "Explain the change." },
              { kind: "diff", anchor },
            ],
          },
        ],
        coverage: {
          totalChangedLines: 2,
          coveredChangedLines: 1,
          uncovered: [],
        },
      },
    };
    const calls: any[] = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        rpc: {
          review: () => ({ review }),
          revisions: () => ({ revisions: [] }),
          addAnnotation: (input: any) => {
            calls.push(input);
            return {
              annotation: {
                ...input,
                id: "mode-draft",
                createdAt: 1,
                sentAt: null,
                resolvedAt: null,
                author: "human",
                parentId: null,
                fileLevel: false,
                carriedFromAnnotationId: null,
                resolutionSuggestion: null,
              },
            };
          },
        } as any,
      },
    );
    const diff = await slot.findByTestId("pierre-diff");
    fireEvent.pointerUp(diff.nextElementSibling!);
    const box = (await slot.findAllByLabelText("Comment", { exact: true }))[0]!;
    fireEvent.change(box, {
      target: { value: "Keep this draft across modes." },
    });
    // Dismiss the compose sheet; the typed draft stays anchored.
    fireEvent.pointerDown(slot.container);
    await vi.waitFor(() => {
      expect(
        slot.queryByRole("dialog", { name: "Comment composer" }),
      ).toBeNull();
    });
    fireEvent.click(slot.getByRole("button", { name: "Tour" }));
    // In Tour mode the code draft lives behind "Resume draft" on the banner.
    expect(
      slot
        .getByRole("button", { name: "Resume draft" })
        .closest("[role='status']"),
    ).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Resume draft" }));
    const resumed = (
      await slot.findAllByLabelText("Comment", { exact: true })
    ).at(-1)!;
    expect((resumed as HTMLTextAreaElement).value).toBe(
      "Keep this draft across modes.",
    );
    // Dismiss again to keep the draft anchored before switching back.
    fireEvent.pointerDown(slot.container);
    await vi.waitFor(() => {
      expect(
        slot.queryByRole("dialog", { name: "Comment composer" }),
      ).toBeNull();
    });
    fireEvent.click(slot.getByRole("button", { name: "Files" }));
    const retained = slot.getAllByLabelText("Comment", { exact: true })[0]!;
    expect((retained as HTMLTextAreaElement).value).toBe(
      "Keep this draft across modes.",
    );
    fireEvent.keyDown(retained, { key: "Enter", ctrlKey: true });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      filePath: "src/example.ts",
      side: "new",
      startLine: 1,
      endLine: 1,
      body: "Keep this draft across modes.",
    });
    fireEvent.click(
      within(
        slot.container.querySelector(
          '[data-review-surface="file:src/example.ts"]',
        ) as HTMLElement,
      ).getByRole("button", { name: "Comment on file" }),
    );
    fireEvent.change(slot.getByLabelText("File comment"), {
      target: { value: "Whole-file draft across modes." },
    });
    fireEvent.click(slot.getByRole("button", { name: "Tour" }));
    expect(
      (slot.getByLabelText("File comment") as HTMLTextAreaElement).value,
    ).toBe("Whole-file draft across modes.");
    fireEvent.click(slot.getByRole("button", { name: "Files" }));
    expect(
      (slot.getByLabelText("File comment") as HTMLTextAreaElement).value,
    ).toBe("Whole-file draft across modes.");
    expect(calls).toHaveLength(1);
    slot.lifecycle.unmount();
  });

  it("opens the mobile compose sheet with line context and recovers a dismissed draft", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const review = reviewFixture();
    const calls: any[] = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        rpc: {
          review: () => ({ review }),
          revisions: () => ({ revisions: [] }),
          addAnnotation: (input: any) => {
            calls.push(input);
            return {
              annotation: {
                ...input,
                id: "sheet-1",
                createdAt: 1,
                sentAt: null,
                resolvedAt: null,
                author: "human",
                parentId: null,
                fileLevel: false,
                carriedFromAnnotationId: null,
                resolutionSuggestion: null,
              },
            };
          },
        } as any,
      },
    );
    const diff = await slot.findByTestId("pierre-diff");
    fireEvent.pointerUp(diff.nextElementSibling!);
    const sheet = await slot.findByRole("dialog", { name: "Comment composer" });
    expect(within(sheet).getAllByText("New line 1").length).toBeGreaterThan(0);
    expect(within(sheet).getByText("src/example.ts")).toBeTruthy();

    // An empty-body dismiss clears the whole draft, including the selection.
    fireEvent.pointerDown(slot.container);
    await vi.waitFor(() => {
      expect(
        slot.queryByRole("dialog", { name: "Comment composer" }),
      ).toBeNull();
    });
    expect(slot.queryByLabelText("Comment", { exact: true })).toBeNull();

    // A dismiss with typed text keeps the draft anchored and resumable.
    fireEvent.pointerUp(diff.nextElementSibling!);
    const box = (await slot.findAllByLabelText("Comment", { exact: true })).at(
      -1,
    )!;
    fireEvent.change(box, { target: { value: "Keep me for later." } });
    fireEvent.pointerDown(slot.container);
    await vi.waitFor(() => {
      expect(
        slot.queryByRole("dialog", { name: "Comment composer" }),
      ).toBeNull();
    });
    fireEvent.click(slot.getByRole("button", { name: "Resume draft" }));
    expect(
      (
        (await slot.findAllByLabelText("Comment", { exact: true })).at(
          -1,
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("Keep me for later.");
    slot.getAllByRole("button", { name: "Add comment" }).at(-1)!.click();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      filePath: "src/example.ts",
      body: "Keep me for later.",
    });
    slot.lifecycle.unmount();
  });

  it("opens a cursor-line editor without requiring a range and leaves input typing and Tab alone", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const viewed: any[] = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        rpc: {
          review: () => ({ review: reviewFixture() }),
          revisions: () => ({ revisions: [] }),
          markFileViewed: (input: any) => {
            viewed.push(input);
            return { viewedCount: 1 };
          },
        } as any,
      },
    );
    const surface = await slot.findByRole("region", { name: "File diff" });
    fireEvent.keyDown(surface, { key: "c" });
    const box = (
      await slot.findAllByLabelText("Comment", { exact: true })
    ).find((node) => node === document.activeElement)!;
    expect(box).toBeTruthy();
    fireEvent.keyDown(box, { key: "m" });
    expect(viewed).toEqual([]);
    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    surface.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    slot.lifecycle.unmount();
  });

  it("renders cross-file ordered tour blocks and their exact excerpts without advancing viewed state", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const base = reviewFixture();
    const first = {
      filePath: "src/example.ts",
      side: "new",
      startLine: 2,
      endLine: 2,
      valid: true,
      reason: null,
    };
    const second = { ...first, filePath: "docs/guide.md" };
    const invalid = {
      ...first,
      filePath: "missing.ts",
      valid: false,
      reason: "file-not-in-revision",
    };
    const review = {
      ...base,
      files: [
        ...base.files,
        {
          ...base.files[0]!,
          path: "docs/guide.md",
          patch: patch.replaceAll("src/example.ts", "docs/guide.md"),
        },
      ],
      tour: {
        reviewId: base.id,
        title: "Cross-file tour",
        overview: null,
        createdAt: 1,
        steps: [
          {
            id: "cross",
            title: "One logical change",
            anchors: [first, second, invalid],
            blocks: [
              { kind: "narrative", body: "Start with the implementation." },
              { kind: "diff", anchor: first },
              { kind: "narrative", body: "Then follow the documentation." },
              { kind: "diff", anchor: second },
              { kind: "diff", anchor: invalid },
              {
                kind: "evidence",
                card: {
                  kind: "before-after",
                  before: "old",
                  after: "new",
                  note: "Explanation only",
                },
              },
            ],
          },
        ],
        coverage: {
          totalChangedLines: 4,
          coveredChangedLines: 2,
          uncovered: [{ filePath: "src/example.ts", side: "old", line: 2 }],
        },
      },
    };
    const viewed: any[] = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        rpc: {
          review: () => ({ review }),
          revisions: () => ({ revisions: [] }),
          markFileViewed: (input: any) => {
            viewed.push(input);
            return { viewedCount: 1 };
          },
        } as any,
      },
    );
    await slot.findByRole("navigation", { name: "Changed files" });
    fireEvent.click(slot.getByRole("button", { name: "Tour" }));
    const document = within(
      slot.getByRole("region", { name: "Review document" }),
    );
    expect(document.getAllByTestId("pierre-diff")).toHaveLength(2);
    expect(document.getByText("Then follow the documentation.")).toBeTruthy();
    expect(document.getByText(/missing.ts.*unavailable/)).toBeTruthy();
    expect(document.getByText("Agent-authored before / after")).toBeTruthy();
    expect(document.queryByRole("button", { name: "Mark viewed" })).toBeNull();
    const source = slot.container.querySelector(
      '[data-review-surface="tour:cross:1"]',
    )!;
    fireEvent.keyDown(source, { key: "m" });
    expect(viewed).toEqual([]);
    fireEvent.click(
      document.getAllByRole("button", { name: "Full file →" })[1]!,
    );
    expect(slot.getAllByTestId("pierre-diff")).toHaveLength(2);
    expect(
      slot.getByRole("button", { name: "Files" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(viewed).toEqual([]);
    slot.lifecycle.unmount();
  });

  it("identifies the active file and exposes viewed progress as navigation changes", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const review = {
      ...reviewFixture(),
      files: [
        ...reviewFixture().files,
        {
          ...reviewFixture().files[0]!,
          path: "docs/guide.md",
          patch: patch.replaceAll("src/example.ts", "docs/guide.md"),
        },
      ],
    };
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
          markFileViewed: async () => ({ viewedCount: 1 }),
        } as any,
      },
    );

    const nav = await slot.findByRole("navigation", { name: "Changed files" });
    const source = within(nav).getByRole("button", { name: /src\/example.ts/ });
    const docs = within(nav).getByRole("button", { name: /docs\/guide.md/ });
    const progress = slot.getByRole("progressbar", { name: "Files viewed" });
    expect(source.getAttribute("aria-current")).toBe("true");
    expect(docs.hasAttribute("aria-current")).toBe(false);
    expect(progress.getAttribute("aria-valuenow")).toBe("0");
    expect(progress.getAttribute("aria-valuemax")).toBe("2");

    fireEvent.click(docs);
    await vi.waitFor(() => {
      expect(docs.getAttribute("aria-current")).toBe("true");
      expect(source.hasAttribute("aria-current")).toBe(false);
    });
    fireEvent.click(
      within(slot.getByRole("region", { name: "File diff" })).getByRole(
        "button",
        { name: "Mark viewed" },
      ),
    );
    await vi.waitFor(() => {
      expect(progress.getAttribute("aria-valuenow")).toBe("1");
      expect(progress.getAttribute("aria-valuetext")).toBe(
        "1 of 2 files viewed",
      );
      expect(docs.getAttribute("aria-current")).toBe("true");
    });
    expect(within(docs).getByLabelText("Viewed")).toBeTruthy();
    expect(slot.getByRole("region", { name: "File diff" })).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("shows immutable old/new image sides and keeps file-level comments available", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const review = {
      ...reviewFixture(),
      files: [
        {
          ...reviewFixture().files[0]!,
          status: "modified",
          binary: true,
          patch: "",
          oldIdentity: "old-hash",
          newIdentity: "new-hash",
          imageSides: {
            old: {
              path: "assets/old.png",
              mimeType: "image/png",
              sizeBytes: 12,
              width: 2,
              height: 2,
              sha256: "old-hash",
            },
            new: {
              path: "assets/new.png",
              mimeType: "image/png",
              sizeBytes: 14,
              width: 3,
              height: 3,
              sha256: "new-hash",
            },
          },
        },
      ],
    };
    const assetCalls: any[] = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
          reviewImageAsset: async (input: any) => {
            assetCalls.push(input);
            return {
              asset: {
                contentBase64: "aGVsbG8=",
                mimeType: "image/png",
                sizeBytes: 12,
                width: 2,
                height: 2,
                sha256: input.side === "old" ? "old-hash" : "new-hash",
              },
            };
          },
        } as any,
      },
    );
    expect(
      await slot.findByRole("img", { name: "Old snapshot of assets/old.png" }),
    ).toBeTruthy();
    expect(
      await slot.findByRole("img", { name: "New snapshot of assets/new.png" }),
    ).toBeTruthy();
    const moreSummary = slot.getByText("More");
    fireEvent.click(moreSummary);
    expect(
      within(moreSummary.closest("details")!).getByRole("button", {
        name: "Comment on file",
      }),
    ).toBeTruthy();
    expect(assetCalls.map((call) => call.side).sort()).toEqual(["new", "old"]);
    slot.lifecycle.unmount();
  });

  it("navigates a keyboard-only old-side multiline range and saves its exact anchor", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const review = reviewFixture();
    const addCalls: any[] = [];
    const viewedCalls: any[] = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
          revisionDelta: async () => ({
            currentReviewId: review.id,
            status: "comparable",
            changedPaths: [],
            unchangedPaths: [],
            unknownPaths: [],
            revertedPaths: [],
            baselines: [],
            reason: null,
          }),
          markFileViewed: async (input: any) => {
            viewedCalls.push(input);
            return { viewedCount: 1 };
          },
          addAnnotation: async (input: any) => {
            addCalls.push(input);
            return {
              annotation: {
                id: "comment-1",
                filePath: input.filePath,
                side: input.side,
                startLine: input.startLine,
                endLine: input.endLine,
                body: input.body,
                createdAt: 1,
                sentAt: null,
                resolvedAt: null,
                author: "human",
                parentId: null,
                fileLevel: false,
                carriedFromAnnotationId: null,
                resolutionSuggestion: null,
              },
            };
          },
        } as any,
      },
    );
    const diff = await slot.findByRole("region", { name: "File diff" });
    diff.focus();
    expect(document.activeElement).toBe(diff);
    fireEvent.keyDown(diff, { key: "h" });
    fireEvent.keyDown(diff, { key: "j" });
    fireEvent.keyDown(diff, { key: "V" });
    expect(slot.queryAllByLabelText("Comment", { exact: true })).toHaveLength(
      0,
    );
    fireEvent.keyDown(diff, { key: "j" });
    fireEvent.keyDown(diff, { key: "c" });
    const boxes = await slot.findAllByLabelText("Comment", { exact: true });
    const box =
      boxes.find((candidate) => candidate === document.activeElement) ??
      boxes[0]!;
    fireEvent.change(box, { target: { value: "Check this deletion" } });
    fireEvent.click(
      slot.getAllByRole("button", { name: "Add comment" }).at(-1)!,
    );
    await vi.waitFor(() => expect(addCalls).toHaveLength(1));
    await vi.waitFor(() =>
      expect(slot.queryAllByLabelText("Comment", { exact: true })).toHaveLength(
        0,
      ),
    );
    await vi.waitFor(() => expect(document.activeElement).toBe(diff));
    expect(addCalls[0]).toMatchObject({
      filePath: "src/example.ts",
      side: "old",
      startLine: 2,
      endLine: 3,
      body: "Check this deletion",
    });
    expect(viewedCalls).toHaveLength(0);
    slot.lifecycle.unmount();
  });

  it.each(["file", "line"])(
    "focuses a new %s comment, guards keyboard submission, and preserves a failed draft",
    async (kind) => {
      const app = await loadPluginApp(() => import("./app"));
      const review = reviewFixture();
      const addCalls: any[] = [];
      let rejectAdd: ((cause: Error) => void) | undefined;
      const slot = renderSlot(
        app.navPanels[0]!,
        { subPath: "review/thread-ui" },
        {
          context: { projectId: "project-ui", threadId: "thread-ui" },
          rpc: {
            review: async () => ({ review }),
            revisions: async () => ({ revisions: [] }),
            addAnnotation: (input: any) => {
              addCalls.push(input);
              return new Promise((_resolve, reject) => {
                rejectAdd = reject;
              });
            },
          } as any,
        },
      );
      await slot.findByTestId("pierre-diff");
      if (kind === "file") {
        const moreSummary = slot.getByText("More");
        fireEvent.click(moreSummary);
        fireEvent.click(
          within(moreSummary.closest("details")!).getByRole("button", {
            name: "Comment on file",
          }),
        );
      } else
        fireEvent.pointerUp(
          slot.getByTestId("pierre-diff").nextElementSibling!,
        );
      const label = kind === "file" ? "File comment" : "Comment";
      const boxes = await slot.findAllByLabelText(label, { exact: true });
      const box = boxes.find((node) => node === document.activeElement)!;
      expect(box).toBeTruthy();
      fireEvent.change(box, { target: { value: "  keep this feedback  " } });
      fireEvent.keyDown(box, {
        key: "Enter",
        ctrlKey: true,
        isComposing: true,
      });
      expect(addCalls).toHaveLength(0);
      fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
      fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
      await vi.waitFor(() => expect(addCalls).toHaveLength(1));
      expect(addCalls[0]).toMatchObject({
        body: "keep this feedback",
        filePath: "src/example.ts",
        ...(kind === "file"
          ? { fileLevel: true }
          : { side: "new", startLine: 1, endLine: 1 }),
      });
      rejectAdd?.(new Error("Comment could not be saved"));
      await slot.findByRole("alert");
      expect((box as HTMLTextAreaElement).value).toBe("  keep this feedback  ");
      expect(
        slot
          .getAllByRole("button", { name: "Add comment" })
          .some((button) => !button.hasAttribute("disabled")),
      ).toBe(true);
      slot.lifecycle.unmount();
    },
  );

  it.each(["final note", "earlier note"])(
    "waits for review-note saves and sends the latest draft only once (%s)",
    async (finalNote) => {
      const app = await loadPluginApp(() => import("./app"));
      const review = { ...reviewFixture(), summary: "earlier note" };
      const order: string[] = [];
      let finishFirstSave: (() => void) | undefined;
      const slot = renderSlot(
        app.navPanels[0]!,
        { subPath: "review/thread-ui" },
        {
          context: { projectId: "project-ui", threadId: "thread-ui" },
          rpc: {
            review: async () => ({ review }),
            revisions: async () => ({ revisions: [] }),
            setReviewSummary: async ({ summary }: any) => {
              order.push(`save:${summary}`);
              if (order.length === 1)
                await new Promise<void>((resolve) => {
                  finishFirstSave = resolve;
                });
              return { summary };
            },
            sendBatch: async () => {
              order.push("send");
              return { sentAt: 10 };
            },
          } as any,
        },
      );
      fireEvent.click(
        (await slot.findAllByRole("button", { name: /Review feedback,/ }))[0]!,
      );
      const dialog = await slot.findByRole("dialog");
      const note = within(dialog).getByLabelText("Review note");
      fireEvent.change(note, { target: { value: "intermediate note" } });
      fireEvent.blur(note);
      await vi.waitFor(() => expect(order).toEqual(["save:intermediate note"]));
      fireEvent.change(note, { target: { value: finalNote } });
      const send = within(dialog).getByRole("button", {
        name: "Send review note to agent",
      });
      fireEvent.click(send);
      fireEvent.click(send);
      expect(order).not.toContain("send");
      finishFirstSave?.();
      await vi.waitFor(() =>
        expect(order).toEqual([
          "save:intermediate note",
          `save:${finalNote}`,
          "send",
        ]),
      );
      expect(slot.inspection.navigateCalls).toContainEqual({
        method: "toThread",
        threadId: "thread-ui",
      });
      slot.lifecycle.unmount();
    },
  );

  it("shows submission errors inside feedback and allows a retry", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const review = { ...reviewFixture(), summary: "ready note" };
    let attempts = 0;
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
          setReviewSummary: async ({ summary }: any) => ({ summary }),
          sendBatch: async () => {
            attempts += 1;
            if (attempts === 1)
              throw new Error("Agent is unavailable. Try again.");
            return { sentAt: 10 };
          },
        } as any,
      },
    );
    fireEvent.click(
      (await slot.findAllByRole("button", { name: /Review feedback,/ }))[0]!,
    );
    const dialog = await slot.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Send review note to agent" }),
    );
    const error = await within(dialog).findByRole("alert");
    expect(error.textContent).toContain("Agent is unavailable. Try again.");
    expect(
      (within(dialog).getByLabelText("Review note") as HTMLTextAreaElement)
        .value,
    ).toBe("ready note");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Send review note to agent" }),
    );
    await vi.waitFor(() => expect(attempts).toBe(2));
    slot.lifecycle.unmount();
  });

  it("sends a newly typed note only after saving it, preserving the draft on save failure", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const review = reviewFixture();
    let saves = 0;
    let sends = 0;
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
          setReviewSummary: async ({ summary }: any) => {
            saves += 1;
            if (saves === 1) throw new Error("Could not save your note");
            return { summary };
          },
          sendBatch: async () => {
            sends += 1;
            return { sentAt: 10 };
          },
        } as any,
      },
    );
    fireEvent.click(
      (await slot.findAllByRole("button", { name: /Review feedback,/ }))[0]!,
    );
    const dialog = await slot.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Add a review note" }),
    );
    const note = within(dialog).getByLabelText("Review note");
    fireEvent.change(note, { target: { value: "new note" } });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Send review note to agent" }),
    );
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      "Could not save your note",
    );
    expect(sends).toBe(0);
    expect((note as HTMLTextAreaElement).value).toBe("new note");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Send review note to agent" }),
    );
    await vi.waitFor(() => expect(sends).toBe(1));
    expect(saves).toBe(2);
    slot.lifecycle.unmount();
  });

  it("keeps collapsed context expandable through Pierre's supported loader", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const review = reviewFixture();
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({
            revisions: [
              {
                id: review.id,
                threadId: review.threadId,
                snapshot: review.snapshot,
                createdAt: review.createdAt,
                target: { type: "uncommitted" },
                fileCount: 1,
                annotationCount: 0,
                unresolvedCount: 0,
                viewedCount: 0,
              },
            ],
          }),
          reviewFileContents: async () => ({
            old: { path: "src/example.ts", content: "context\nold\ncontext\n" },
            new: { path: "src/example.ts", content: "context\nnew\ncontext\n" },
          }),
        } as any,
      },
    );

    const diff = await slot.findByTestId("pierre-diff");
    expect(diff.getAttribute("data-expand-unchanged")).toBe("false");
    expect(diff.getAttribute("data-hunk-separators")).toBe("line-info");
    expect(diff.getAttribute("data-line-diff-type")).toBe("word-alt");
    slot.getByRole("button", { name: "Load context" }).click();
    await vi.waitFor(() => {
      expect(slot.inspection.rpcCalls).toContainEqual({
        method: "reviewFileContents",
        input: { reviewId: review.id, filePath: "src/example.ts" },
      });
    });
    slot.lifecycle.unmount();
  });

  it("opens accessible feedback, preserves drafts, and sends selected comments", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const root = {
      id: "22222222-2222-4222-8222-222222222221",
      filePath: "src/example.ts",
      side: "new",
      startLine: 1,
      endLine: 1,
      body: "review this line",
      createdAt: 1,
      sentAt: null,
      resolvedAt: null,
      author: "human",
      parentId: null,
      fileLevel: false,
      carriedFromAnnotationId: null,
      resolutionSuggestion: null,
    };
    const review = { ...reviewFixture(), annotations: [root] } as any;
    const calls: any[] = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
          setReviewSummary: async ({ summary }: any) => ({ summary }),
          sendBatch: async (input: any) => {
            calls.push(input);
            return { sentAt: 10 };
          },
        } as any,
      },
    );

    expect(slot.queryByRole("dialog")).toBeNull();
    const trigger = (
      await slot.findAllByRole("button", {
        name: "Review feedback, 1 pending/unsent comments",
      })
    )[0]!;
    trigger.click();
    const dialog = await slot.findByRole("dialog");
    expect(dialog).toBeTruthy();
    // Portals leave the panel's DOM subtree, so they must retain its CSS scope.
    expect(dialog.getAttribute("data-bb-plugin")).toBe("test-plugin");
    expect(dialog.hasAttribute("data-bb-plugin-root")).toBe(true);
    expect(dialog.hasAttribute("data-bb-portaled-overlay")).toBe(true);
    expect((dialog as HTMLElement).style.paddingTop).toBe(
      "calc(1rem + env(safe-area-inset-top))",
    );
    expect((dialog as HTMLElement).style.paddingBottom).toBe(
      "calc(1rem + env(safe-area-inset-bottom))",
    );
    expect(slot.getByRole("heading", { name: "Review feedback" })).toBeTruthy();

    fireEvent.click(
      within(dialog).getAllByRole("button", { name: "Reply" })[0]!,
    );
    const reply = await within(dialog).findByLabelText(
      "Reply to src/example.ts:1 (new)",
    );
    fireEvent.change(reply, { target: { value: "draft reply" } });
    // The note is collapsed by default; open it like a user would.
    fireEvent.click(
      within(dialog).getAllByRole("button", { name: "Add a review note" })[0]!,
    );
    const note = slot.getByLabelText("Review note");
    fireEvent.change(note, { target: { value: "draft summary" } });
    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
    await vi.waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
    trigger.click();
    await slot.findByRole("dialog");
    expect(
      (slot.getByLabelText("Review note") as HTMLTextAreaElement).value,
    ).toBe("draft summary");
    expect(
      (
        slot.getByLabelText(
          "Reply to src/example.ts:1 (new)",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("draft reply");

    slot.getByRole("button", { name: "Send 1 comment to agent" }).click();
    await vi.waitFor(() => {
      expect(calls).toEqual([
        { reviewId: review.id, annotationIds: [root.id] },
      ]);
    });
    slot.lifecycle.unmount();
  });

  it("keeps resolved threads behind a disclosure and pending work on top", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const base = {
      filePath: "src/example.ts",
      side: "new" as const,
      startLine: 1,
      endLine: 1,
      createdAt: 1,
      sentAt: null,
      resolvedAt: null,
      author: "human",
      parentId: null,
      fileLevel: false,
      carriedFromAnnotationId: null,
      resolutionSuggestion: null,
    };
    const open = {
      ...base,
      id: "88888888-8888-4888-8888-888888888881",
      body: "still open",
    };
    const done = {
      ...base,
      id: "88888888-8888-4888-8888-888888888882",
      body: "already handled",
      resolvedAt: 9,
    };
    const review = { ...reviewFixture(), annotations: [done, open] } as any;
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
        } as any,
      },
    );
    (
      await slot.findAllByRole("button", {
        name: "Review feedback, 1 pending/unsent comments",
      })
    )[0]!.click();
    const dialog = await slot.findByRole("dialog");

    // The note stays collapsed until asked for.
    expect(within(dialog).queryByLabelText("Review note")).toBeNull();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Add a review note" }),
    );
    expect(within(dialog).getByLabelText("Review note")).toBeTruthy();

    // Open work is visible; resolved history needs one click.
    expect(within(dialog).getByText("still open")).toBeTruthy();
    expect(within(dialog).queryByText("already handled")).toBeNull();
    const disclosure = within(dialog).getByRole("button", {
      name: "Resolved (1)",
    });
    fireEvent.click(disclosure);
    expect(within(dialog).getByText("already handled")).toBeTruthy();
    // "carried" is gone: it is history within one refresh, not news.
    expect(within(dialog).queryByText("carried")).toBeNull();
    slot.lifecycle.unmount();
  });

  it("sends every pending comment in one batch, with nothing to select", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const root = {
      id: "77777777-7777-4777-8777-777777777771",
      filePath: "src/example.ts",
      side: "new",
      startLine: 1,
      endLine: 1,
      body: "agent finding",
      createdAt: 1,
      sentAt: null,
      resolvedAt: null,
      author: "agent",
      parentId: null,
      fileLevel: false,
      carriedFromAnnotationId: null,
      resolutionSuggestion: null,
    };
    // A human reply nested under an AI comment: exactly the case that read as
    // unsendable because the parent's own checkbox is disabled.
    const reply = {
      ...root,
      id: "77777777-7777-4777-8777-777777777772",
      body: "human response",
      author: "human",
      parentId: root.id,
    };
    const other = {
      ...root,
      id: "77777777-7777-4777-8777-777777777773",
      body: "another human note",
      author: "human",
    };
    const review = {
      ...reviewFixture(),
      annotations: [root, reply, other],
    } as any;
    const sendCalls: any[] = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
          sendBatch: async (input: any) => {
            sendCalls.push(input);
            return { sentAt: 30 };
          },
        } as any,
      },
    );

    (
      await slot.findAllByRole("button", {
        name: "Review feedback, 2 pending/unsent comments",
      })
    )[0]!.click();
    const dialog = await slot.findByRole("dialog");

    // The reply is labelled as the user's own, and still to be sent.
    expect(within(dialog).getByText("Your reply")).toBeTruthy();
    expect(within(dialog).getAllByText("unsent").length).toBe(2);

    // Nothing to tick: the button sends everything pending in one batch.
    expect(within(dialog).queryAllByRole("checkbox")).toHaveLength(0);
    const sendAll = within(dialog).getAllByRole("button", {
      name: "Send 2 comments to agent",
    })[0]!;
    fireEvent.click(sendAll);
    await vi.waitFor(() =>
      expect(sendCalls).toEqual([
        {
          reviewId: review.id,
          annotationIds: [reply.id, other.id],
        },
      ]),
    );
    slot.lifecycle.unmount();
  });

  it("replies inline to an agent root and sends the human reply", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const root = {
      id: "66666666-6666-4666-8666-666666666661",
      filePath: "src/example.ts",
      side: "new",
      startLine: 1,
      endLine: 1,
      body: "agent finding",
      createdAt: 1,
      sentAt: null,
      resolvedAt: null,
      author: "agent",
      parentId: null,
      fileLevel: false,
      carriedFromAnnotationId: null,
      resolutionSuggestion: null,
    };
    const humanReply = {
      ...root,
      id: "66666666-6666-4666-8666-666666666662",
      body: "human response",
      author: "human",
      parentId: root.id,
    };
    const review = { ...reviewFixture(), annotations: [root] } as any;
    const addCalls: any[] = [];
    const sendCalls: any[] = [];
    let addAttempt = 0;
    let rejectFirstAttempt: ((cause: Error) => void) | undefined;
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
          addAnnotation: (input: any) => {
            addCalls.push(input);
            addAttempt += 1;
            if (addAttempt === 1)
              return new Promise((_resolve, reject) => {
                rejectFirstAttempt = reject;
              });
            return Promise.resolve({ annotation: humanReply });
          },
          sendBatch: async (input: any) => {
            sendCalls.push(input);
            return { sentAt: 20 };
          },
        } as any,
      },
    );

    const replyButton = await slot.findByRole("button", {
      name: "Reply to AI comment at src/example.ts:1 (new)",
    });
    fireEvent.click(replyButton);
    let textarea = await slot.findByLabelText(
      "Reply to src/example.ts:1 (new)",
    );
    fireEvent.change(textarea, { target: { value: "discard this draft" } });
    fireEvent.click(slot.getByRole("button", { name: "Cancel" }));
    expect(slot.queryByLabelText("Reply to src/example.ts:1 (new)")).toBeNull();

    fireEvent.click(
      slot.getByRole("button", {
        name: "Reply to AI comment at src/example.ts:1 (new)",
      }),
    );
    textarea = await slot.findByLabelText("Reply to src/example.ts:1 (new)");
    fireEvent.change(textarea, { target: { value: "human response" } });
    const submitReply = slot.getByRole("button", { name: "Reply" });
    fireEvent.pointerDown(submitReply);
    fireEvent.pointerUp(submitReply);
    expect(slot.queryByText(/Comment on src\/example\.ts:1/)).toBeNull();
    fireEvent.click(submitReply);
    fireEvent.click(submitReply);
    await vi.waitFor(() => expect(addCalls).toHaveLength(1));
    expect((submitReply as HTMLButtonElement).disabled).toBe(true);
    rejectFirstAttempt?.(new Error("temporary reply failure"));
    await slot.findByText("temporary reply failure");
    expect((textarea as HTMLTextAreaElement).value).toBe("human response");
    fireEvent.click(slot.getByRole("button", { name: "Reply" }));

    await vi.waitFor(() => {
      expect(addCalls).toHaveLength(2);
      expect(addCalls[1]).toMatchObject({
        reviewId: review.id,
        filePath: "src/example.ts",
        side: "new",
        startLine: 1,
        endLine: 1,
        body: "human response",
        parentId: root.id,
      });
    });
    fireEvent.click(
      (
        await slot.findAllByRole("button", {
          name: "Review feedback, 1 pending/unsent comments",
        })
      )[1]!,
    );
    const dialog = await slot.findByRole("dialog");
    // Nothing to tick: the reply is the only pending comment, so it goes.
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Send 1 comment to agent" }),
    );
    await vi.waitFor(() => {
      expect(sendCalls).toEqual([
        { reviewId: review.id, annotationIds: [humanReply.id] },
      ]);
    });
    slot.lifecycle.unmount();
  });

  it("replies to an AI reply by targeting its existing root", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const root = {
      id: "77777777-7777-4777-8777-777777777771",
      filePath: "src/example.ts",
      side: "new",
      startLine: 1,
      endLine: 1,
      body: "human root",
      createdAt: 1,
      sentAt: null,
      resolvedAt: null,
      author: "human",
      parentId: null,
      fileLevel: false,
      carriedFromAnnotationId: null,
      resolutionSuggestion: null,
    };
    const agentReply = {
      ...root,
      id: "77777777-7777-4777-8777-777777777772",
      body: "agent reply",
      author: "agent",
      parentId: root.id,
    };
    const humanReply = {
      ...root,
      id: "77777777-7777-4777-8777-777777777773",
      body: "human follow-up",
      parentId: root.id,
    };
    const review = {
      ...reviewFixture(),
      annotations: [root, agentReply],
    } as any;
    let submitted: any;
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
          addAnnotation: async (input: any) => {
            submitted = input;
            return { annotation: humanReply };
          },
        } as any,
      },
    );

    fireEvent.click(
      await slot.findByRole("button", {
        name: "Reply to AI comment at src/example.ts:1 (new)",
      }),
    );
    const textarea = await slot.findByLabelText(
      "Reply to src/example.ts:1 (new)",
    );
    fireEvent.change(textarea, { target: { value: "human follow-up" } });
    fireEvent.click(slot.getByRole("button", { name: "Reply" }));
    await vi.waitFor(() => expect(submitted).toBeTruthy());
    expect(submitted).toMatchObject({
      parentId: root.id,
      body: "human follow-up",
    });
    expect(submitted.parentId).not.toBe(agentReply.id);
    await slot.findByText("human follow-up");
    slot.lifecycle.unmount();
  });

  it("keeps file-level replies on the existing whole-file comment path", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const root = {
      id: "88888888-8888-4888-8888-888888888881",
      filePath: "src/example.ts",
      side: "new",
      startLine: 0,
      endLine: 0,
      body: "whole-file agent note",
      createdAt: 1,
      sentAt: null,
      resolvedAt: null,
      author: "agent",
      parentId: null,
      fileLevel: true,
      carriedFromAnnotationId: null,
      resolutionSuggestion: null,
    };
    const humanReply = {
      ...root,
      id: "88888888-8888-4888-8888-888888888882",
      body: "whole-file response",
      author: "human",
      parentId: root.id,
    };
    const review = { ...reviewFixture(), annotations: [root] } as any;
    let submitted: any;
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
          addAnnotation: async (input: any) => {
            submitted = input;
            return { annotation: humanReply };
          },
        } as any,
      },
    );

    fireEvent.click(await slot.findByRole("button", { name: "Reply" }));
    const textarea = await slot.findByLabelText(
      "Reply to src/example.ts (whole file)",
    );
    fireEvent.change(textarea, { target: { value: "whole-file response" } });
    fireEvent.click(slot.getByRole("button", { name: "Reply" }));
    await vi.waitFor(() => expect(submitted).toBeTruthy());
    expect(submitted).toMatchObject({
      filePath: "src/example.ts",
      startLine: 0,
      endLine: 0,
      parentId: root.id,
    });
    slot.lifecycle.unmount();
  });

  it("focuses reply editors and submits with the keyboard shortcut", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const humanRoot = {
      id: "99999999-9999-4999-8999-999999999991",
      filePath: "src/example.ts",
      side: "new",
      startLine: 1,
      endLine: 1,
      body: "human root",
      createdAt: 1,
      sentAt: null,
      resolvedAt: null,
      author: "human",
      parentId: null,
      fileLevel: false,
      carriedFromAnnotationId: null,
      resolutionSuggestion: null,
    };
    const agentRoot = {
      ...humanRoot,
      id: "99999999-9999-4999-8999-999999999992",
      body: "agent note",
      author: "agent",
    };
    const review = {
      ...reviewFixture(),
      annotations: [humanRoot, agentRoot],
    } as any;
    const addCalls: any[] = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
          addAnnotation: async (input: any) => {
            addCalls.push(input);
            return {
              annotation: {
                ...input,
                id: `reply-${addCalls.length}`,
                createdAt: 10 + addCalls.length,
                sentAt: null,
                resolvedAt: null,
                fileLevel: false,
                carriedFromAnnotationId: null,
                resolutionSuggestion: null,
                parentId: input.parentId,
                author: "human",
              },
            };
          },
        } as any,
      },
    );

    // Inline AI reply focuses on open.
    fireEvent.click(
      await slot.findByRole("button", {
        name: "Reply to AI comment at src/example.ts:1 (new)",
      }),
    );
    const inlineBox = await slot.findByLabelText(
      "Reply to src/example.ts:1 (new)",
    );
    expect(document.activeElement).toBe(inlineBox);
    expect(slot.getByText(/to submit/)).toBeTruthy();

    fireEvent.change(inlineBox, { target: { value: "ctrl reply" } });
    fireEvent.keyDown(inlineBox, { key: "Enter", ctrlKey: true });
    await vi.waitFor(() => expect(addCalls).toHaveLength(1));
    expect(addCalls[0]).toMatchObject({
      body: "ctrl reply",
      parentId: agentRoot.id,
    });
    await vi.waitFor(() =>
      expect(
        slot.queryByLabelText("Reply to src/example.ts:1 (new)"),
      ).toBeNull(),
    );

    // Meta (Cmd) submit works the same way.
    fireEvent.click(
      slot.getByRole("button", {
        name: "Reply to AI comment at src/example.ts:1 (new)",
      }),
    );
    const cmdBox = await slot.findByLabelText(
      "Reply to src/example.ts:1 (new)",
    );
    expect(document.activeElement).toBe(cmdBox);
    fireEvent.change(cmdBox, { target: { value: "cmd reply" } });
    fireEvent.keyDown(cmdBox, { key: "Enter", metaKey: true });
    await vi.waitFor(() => expect(addCalls).toHaveLength(2));
    expect(addCalls[1]).toMatchObject({ body: "cmd reply" });

    // A top-level human comment reply focuses too, and the button still works.
    fireEvent.click(
      (await slot.findAllByRole("button", { name: /Review feedback/ }))[0]!,
    );
    const dialog = await slot.findByRole("dialog");
    fireEvent.click(
      within(dialog).getAllByRole("button", { name: "Reply" })[0]!,
    );
    const drawerBox = await within(dialog).findByLabelText(
      "Reply to src/example.ts:1 (new)",
    );
    expect(document.activeElement).toBe(drawerBox);
    fireEvent.change(drawerBox, { target: { value: "drawer reply" } });
    fireEvent.click(
      within(dialog).getAllByRole("button", { name: "Reply" })[0]!,
    );
    await vi.waitFor(() => expect(addCalls).toHaveLength(3));
    expect(addCalls[2]).toMatchObject({
      body: "drawer reply",
      parentId: humanRoot.id,
    });
    slot.lifecycle.unmount();
  });

  it("edits and deletes human comments only", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const humanRoot = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      filePath: "src/example.ts",
      side: "new",
      startLine: 1,
      endLine: 1,
      body: "human root",
      createdAt: 1,
      sentAt: null,
      resolvedAt: null,
      author: "human",
      parentId: null,
      fileLevel: false,
      carriedFromAnnotationId: null,
      resolutionSuggestion: null,
    };
    const humanReply = {
      ...humanRoot,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
      body: "human reply",
      parentId: humanRoot.id,
    };
    const sentComment = {
      ...humanRoot,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
      body: "sent",
      sentAt: 5,
    };
    const agentComment = {
      ...humanRoot,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
      body: "agent",
      author: "agent",
    };
    const review = {
      ...reviewFixture(),
      annotations: [humanRoot, humanReply, sentComment, agentComment],
    } as any;
    const editCalls: any[] = [];
    const removeCalls: any[] = [];
    const sendCalls: any[] = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
          editAnnotation: async (input: any) => {
            editCalls.push(input);
            return {
              annotation: {
                ...humanRoot,
                id: input.annotationId,
                body: input.body,
              },
            };
          },
          removeAnnotation: async (input: any) => {
            removeCalls.push(input);
            return { ok: true };
          },
          sendBatch: async (input: any) => {
            sendCalls.push(input);
            return { sentAt: 30 };
          },
        } as any,
      },
    );

    // Agent and sent comments expose neither edit nor delete, inline or in
    // the drawer.
    expect(
      (await slot.findAllByLabelText("Edit src/example.ts:1 (new)"))[0],
    ).toBeTruthy();
    expect(slot.queryByLabelText("Edit src/example.ts:2 (new)")).toBeNull();
    expect(slot.queryByLabelText("Delete src/example.ts:2 (new)")).toBeNull();
    expect(slot.queryByLabelText("Edit src/example.ts:3 (new)")).toBeNull();
    expect(slot.queryByLabelText("Delete src/example.ts:3 (new)")).toBeNull();
    fireEvent.click(
      (
        await slot.findAllByRole("button", {
          name: "Review feedback, 2 pending/unsent comments",
        })
      )[0]!,
    );
    const dialog = await slot.findByRole("dialog");
    // The drawer renders once per layout, so scope to the first match.
    const inDrawer = (label: string) =>
      within(dialog).queryAllByLabelText(label);
    expect(inDrawer("Edit src/example.ts:1 (new)").length).toBeGreaterThan(0);
    expect(inDrawer("Edit src/example.ts:2 (new)")).toHaveLength(0);
    expect(inDrawer("Delete src/example.ts:2 (new)")).toHaveLength(0);
    expect(inDrawer("Edit src/example.ts:3 (new)")).toHaveLength(0);
    expect(inDrawer("Delete src/example.ts:3 (new)")).toHaveLength(0);
    // The root has a reply, so delete is visible but disabled with a reason.
    const rootDelete = inDrawer(
      "Delete src/example.ts:1 (new)",
    )[0] as HTMLButtonElement;
    expect(rootDelete.disabled).toBe(true);
    expect(rootDelete.title).toBe(
      "Comment has replies and cannot be deleted on its own.",
    );
    expect(within(dialog).getAllByText("sent").length).toBeGreaterThan(0);

    // Editing a human comment persists and keeps it unsent.
    fireEvent.click(inDrawer("Edit src/example.ts:1 (new)")[0]!);
    const editor = (
      await within(dialog).findAllByLabelText("Edit src/example.ts:1 (new)")
    ).find((node) => node.tagName === "TEXTAREA")!;
    expect(document.activeElement).toBe(editor);
    fireEvent.change(editor, { target: { value: "  reworded root  " } });
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    await vi.waitFor(() => expect(editCalls).toHaveLength(1));
    expect(editCalls[0]).toEqual({
      annotationId: humanRoot.id,
      body: "reworded root",
    });
    await vi.waitFor(() =>
      expect(
        within(dialog).getAllByText("reworded root").length,
      ).toBeGreaterThan(0),
    );
    await vi.waitFor(() =>
      expect(
        inDrawer("Edit src/example.ts:1 (new)").some(
          (node) => node.tagName === "TEXTAREA",
        ),
      ).toBe(false),
    );

    // The edited comment is unsent, so it goes with the batch.
    const sendButton = within(dialog).getAllByRole("button", {
      name: /Send \d+ comment/,
    })[0]!;
    expect(sendButton.getAttribute("disabled")).toBeNull();
    fireEvent.click(sendButton);
    // No selection step: every unsent, unresolved, human comment goes.
    await vi.waitFor(() =>
      expect(sendCalls).toEqual([
        {
          reviewId: review.id,
          annotationIds: [humanRoot.id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"],
        },
      ]),
    );
    slot.lifecycle.unmount();
  });

  it("shows delete for a comment without replies and refuses sent edits", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const humanRoot = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
      filePath: "src/example.ts",
      side: "new",
      startLine: 1,
      endLine: 1,
      body: "solo comment",
      createdAt: 1,
      sentAt: null,
      resolvedAt: null,
      author: "human",
      parentId: null,
      fileLevel: false,
      carriedFromAnnotationId: null,
      resolutionSuggestion: null,
    };
    const review = { ...reviewFixture(), annotations: [humanRoot] } as any;
    const removeCalls: any[] = [];
    const editCalls: any[] = [];
    let failEdit = false;
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
          removeAnnotation: async (input: any) => {
            removeCalls.push(input);
            return { ok: true };
          },
          editAnnotation: async (input: any) => {
            editCalls.push(input);
            if (failEdit) throw new Error("Sent comments are immutable");
            return {
              annotation: {
                ...humanRoot,
                id: input.annotationId,
                body: input.body,
              },
            };
          },
        } as any,
      },
    );

    // A refused edit keeps the draft and the error visible.
    failEdit = true;
    fireEvent.click(
      (await slot.findAllByLabelText("Edit src/example.ts:1 (new)"))[0]!,
    );
    const editor = (
      await slot.findAllByLabelText("Edit src/example.ts:1 (new)")
    ).find((node) => node.tagName === "TEXTAREA")!;
    expect(document.activeElement).toBe(editor);
    fireEvent.change(editor, { target: { value: "kept draft" } });
    fireEvent.click(slot.getAllByRole("button", { name: "Save" })[0]!);
    await slot.findByText("Sent comments are immutable");
    expect(
      (
        (await slot.findAllByLabelText("Edit src/example.ts:1 (new)")).find(
          (node) => node.tagName === "TEXTAREA",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("kept draft");
    expect(editCalls).toHaveLength(1);
    // Cancelling discards it.
    fireEvent.click(slot.getAllByRole("button", { name: "Cancel" })[0]!);
    expect(
      slot
        .queryAllByLabelText("Edit src/example.ts:1 (new)")
        .some((node) => node.tagName === "TEXTAREA"),
    ).toBe(false);

    // A comment without replies deletes inline. The diff renders once per
    // layout, so act on the first match.
    const deleteButton = (
      await slot.findAllByLabelText("Delete src/example.ts:1 (new)")
    )[0]!;
    expect(deleteButton.title).toBe("Delete comment");
    fireEvent.click(deleteButton);
    await vi.waitFor(() =>
      expect(removeCalls).toEqual([{ annotationId: humanRoot.id }]),
    );
    slot.lifecycle.unmount();
  });

  it("keeps all diffs visible when unviewed navigation becomes empty", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const review = {
      ...reviewFixture(),
      files: [
        ...reviewFixture().files,
        {
          ...reviewFixture().files[0],
          path: "docs/guide.md",
          patch: patch.replaceAll("src/example.ts", "docs/guide.md"),
        },
      ],
      viewedPaths: ["docs/guide.md"],
    } as any;
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
          markFileViewed: async () => ({ viewedCount: 2 }),
        } as any,
      },
    );

    fireEvent.click(await slot.findByRole("button", { name: "Unviewed" }));
    const fileSummary = await slot.findByLabelText("Changed file", {
      exact: true,
    });
    fireEvent.click(fileSummary);
    expect(
      openedFileRow(slot, "src/example.ts").getAttribute("aria-current"),
    ).toBe("true");
    slot.getByRole("button", { name: "Viewed & next" }).click();
    await vi.waitFor(() => {
      expect(fileSummary.textContent).toContain("No matching files");
    });
    expect(slot.getAllByText("No matching files.").length).toBeGreaterThan(0);
    expect(slot.getAllByTestId("pierre-diff")).toHaveLength(1);
    expect(slot.queryByRole("dialog", { name: "Review feedback" })).toBeNull();
    slot.lifecycle.unmount();
  });

  it("switches reading modes and keeps the tour empty state in the main document", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review: reviewFixture() }),
          revisions: async () => ({ revisions: [] }),
        } as any,
      },
    );

    await slot.findByLabelText("Review target");
    const tourButton = slot.getByRole("button", { name: "Tour" });
    fireEvent.click(tourButton);
    expect(tourButton.getAttribute("aria-pressed")).toBe("true");
    expect(
      await slot.findByText(/No tour is authored for this immutable revision/),
    ).toBeTruthy();
    expect(
      slot.queryByRole("complementary", { name: "Review tour" }),
    ).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Files" }));
    expect(await slot.findByTestId("pierre-diff")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Keyboard ?" }));
    expect(slot.getAllByText(/Focus this diff surface/).length).toBeGreaterThan(
      0,
    );
    slot.lifecycle.unmount();
  });

  it("steps tour sections with progress on the mobile document", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const base = reviewFixture();
    const tourStep = (id: string, title: string, body: string) => ({
      id,
      title,
      blocks: [{ kind: "narrative", body }],
      anchors: [],
    });
    const review = {
      ...base,
      tour: {
        reviewId: base.id,
        title: "Guided walk",
        overview: null,
        createdAt: 1,
        steps: [
          tourStep("alpha", "Alpha", "Alpha explanation."),
          tourStep("beta", "Beta", "Beta explanation."),
        ],
        coverage: {
          totalChangedLines: 2,
          coveredChangedLines: 2,
          uncovered: [],
        },
      },
    };
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
        } as any,
      },
    );
    fireEvent.click(await slot.findByRole("button", { name: "Tour" }));
    expect(await slot.findByText("Alpha explanation.")).toBeTruthy();
    expect(slot.getByText("Section 1 of 2 · Alpha")).toBeTruthy();
    const previous = slot.getByRole("button", {
      name: "Previous tour section",
    }) as HTMLButtonElement;
    expect(previous.disabled).toBe(true);
    expect(
      (
        slot.getByRole("button", {
          name: "Next tour section",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    fireEvent.click(slot.getByRole("button", { name: "Next tour section" }));
    expect(slot.getByText("Section 2 of 2 · Beta")).toBeTruthy();
    expect(slot.getByText("Beta explanation.")).toBeTruthy();
    expect(
      (
        slot.getByRole("button", {
          name: "Next tour section",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(
      slot.getByRole("button", { name: "Previous tour section" }),
    );
    expect(slot.getByText("Alpha explanation.")).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("keeps phone-only actions in the review menu", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const current = reviewFixture();
    const older = { ...current, id: "99999999-9999-4999-8999-999999999999" };
    const loaded: string[] = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: (input: any) => {
            loaded.push(input.reviewId ?? "current");
            return { review: input.reviewId === older.id ? older : current };
          },
          revisions: () => ({
            revisions: [
              {
                id: current.id,
                threadId: "thread-ui",
                snapshot: current.snapshot,
                createdAt: 2,
                target: current.target,
                fileCount: 1,
                annotationCount: 0,
                unresolvedCount: 0,
                viewedCount: 0,
              },
              {
                id: older.id,
                threadId: "thread-ui",
                snapshot: older.snapshot,
                createdAt: 1,
                target: older.target,
                fileCount: 1,
                annotationCount: 0,
                unresolvedCount: 0,
                viewedCount: 0,
              },
            ],
          }),
        } as any,
      },
    );

    const menu = await slot.findByText("•••");
    fireEvent.click(menu);
    const popover = within(menu.closest("details")!);
    const revisionButtons = popover
      .getAllByRole("button")
      .filter((button) => /open$/.test(button.textContent?.trim() ?? ""));
    expect(revisionButtons).toHaveLength(2);
    expect(revisionButtons[0]!.getAttribute("aria-current")).toBe("true");
    fireEvent.click(revisionButtons[1]!);
    await vi.waitFor(() => expect(loaded).toContain(older.id));

    // Full screen and the compare sheet are reachable from the menu.
    const fullScreen = popover.getByRole("button", { name: "Full screen" });
    fireEvent.click(fullScreen);
    expect(
      popover.getByRole("button", { name: "Exit full screen" }),
    ).toBeTruthy();
    fireEvent.click(
      popover.getByRole("button", { name: "Change review target…" }),
    );
    const compareSheet = await slot.findByRole("dialog", {
      name: "Compare or refresh",
    });
    expect(within(compareSheet).getByLabelText("Review target")).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("lists the files a tour section covers and steps to their excerpts", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const base = reviewFixture();
    const anchorFor = (filePath: string, startLine: number) => ({
      filePath,
      side: "new" as const,
      startLine,
      endLine: startLine,
      valid: true,
      reason: null,
    });
    const review = {
      ...base,
      files: [
        ...base.files,
        {
          ...base.files[0]!,
          path: "docs/guide.md",
          patch: patch.replaceAll("src/example.ts", "docs/guide.md"),
        },
      ],
      tour: {
        reviewId: base.id,
        title: "Tour",
        overview: null,
        createdAt: 1,
        steps: [
          {
            id: "cross",
            title: "Two files",
            anchors: [
              anchorFor("src/example.ts", 1),
              anchorFor("docs/guide.md", 1),
              {
                ...anchorFor("missing.ts", 1),
                valid: false,
                reason: "file-not-in-revision",
              },
            ],
            blocks: [
              { kind: "narrative", body: "Read both files." },
              { kind: "diff", anchor: anchorFor("src/example.ts", 1) },
              { kind: "diff", anchor: anchorFor("docs/guide.md", 1) },
            ],
          },
        ],
        coverage: {
          totalChangedLines: 4,
          coveredChangedLines: 2,
          uncovered: [],
        },
      },
    };
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
        } as any,
      },
    );
    fireEvent.click(await slot.findByRole("button", { name: "Tour" }));
    const firstChip = await slot.findByRole("button", {
      name: "Show src/example.ts in this section",
    });
    expect(
      slot.getByRole("button", { name: "Show docs/guide.md in this section" }),
    ).toBeTruthy();
    // Anchors that cannot render an excerpt get no chip.
    expect(
      slot.queryByRole("button", { name: "Show missing.ts in this section" }),
    ).toBeNull();

    const container = slot.getByRole("region", { name: "Review document" });
    const scrollTo = vi.fn();
    Object.defineProperty(container, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });
    fireEvent.click(firstChip);
    await vi.waitFor(() => expect(scrollTo).toHaveBeenCalled());
    slot.lifecycle.unmount();
  });

  it("toggles split and unified diff rendering", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        rpc: {
          review: async () => ({ review: reviewFixture() }),
          revisions: async () => ({ revisions: [] }),
        } as any,
      },
    );
    const diff = await slot.findByTestId("pierre-diff");
    expect(diff.getAttribute("data-diff-style")).toBe("unified");
    fireEvent.click(
      slot.getAllByRole("button", { name: "Use split diff view" })[0]!,
    );
    await vi.waitFor(() => {
      expect(
        slot.getAllByTestId("pierre-diff")[0]!.getAttribute("data-diff-style"),
      ).toBe("split");
    });
    expect(
      slot.getAllByRole("button", { name: "Use unified diff view" }).length,
    ).toBeGreaterThan(0);
    slot.lifecycle.unmount();
  });

  const baseSuggestionRpc = () => ({
    status: "ok" as const,
    reason: null,
    branchName: "main",
    baseBranch: null,
    defaultBranch: "main",
    mergeBaseBranch: null,
    upstream: "origin/main",
    remoteDefault: "origin/main",
    suggestedBase: "origin/main",
    suggestionSource: "upstream" as const,
  });

  it("prefills the base branch from the environment and says where it came from", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review: reviewFixture() }),
          revisions: async () => ({ revisions: [] }),
          reviewEnvironment: async () => baseSuggestionRpc(),
        } as any,
      },
    );
    const select = (
      await slot.findAllByRole("combobox", {
        name: "Review target",
      })
    )[0]!;
    // The suggestion only applies to targets that need a base branch.
    fireEvent.change(select, { target: { value: "branch" } });
    const baseInput = slot.getAllByLabelText(
      "Base branch",
    )[0]! as HTMLInputElement;
    await vi.waitFor(() => expect(baseInput.value).toBe("origin/main"));
    expect(
      slot.getAllByText("From the upstream of main: origin/main.").length,
    ).toBeGreaterThan(0);
    // No typing needed: the action is enabled straight away.
    expect(
      slot
        .getAllByRole("button", { name: "Review committed" })[0]!
        .hasAttribute("disabled"),
    ).toBe(false);

    // A typed base wins, and the hint stops claiming the value.
    fireEvent.change(baseInput, { target: { value: "release/1.0" } });
    fireEvent.change(select, { target: { value: "all" } });
    expect(
      (slot.getAllByLabelText("Base branch")[0] as HTMLInputElement).value,
    ).toBe("release/1.0");
    await vi.waitFor(() => {
      expect(
        slot.queryAllByText("From the upstream of main: origin/main.").length,
      ).toBe(0);
    });
    slot.lifecycle.unmount();
  });

  it("submits exactly what the base field shows", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const review = reviewFixture();
    const refreshCalls: any[] = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
          reviewEnvironment: async () => baseSuggestionRpc(),
          refreshReview: async (input: any) => {
            refreshCalls.push(input);
            return { review };
          },
        } as any,
      },
    );
    const select = (
      await slot.findAllByRole("combobox", {
        name: "Review target",
      })
    )[0]!;
    const action = () =>
      slot.getAllByRole("button", {
        // After a refresh the panel resets to its saved target, whose action
        // reads "Refresh".
        name: /^(Review (commit|committed|everything)|Refresh)$/,
      })[0]!;

    // A commit target never borrows the base suggestion: a blank sha stays
    // disabled even though a base was detected.
    fireEvent.change(select, { target: { value: "commit" } });
    expect(action().hasAttribute("disabled")).toBe(true);

    // Base targets prefill visibly.
    fireEvent.change(select, { target: { value: "branch" } });
    const baseInput = slot.getAllByLabelText(
      "Base branch",
    )[0]! as HTMLInputElement;
    await vi.waitFor(() => expect(baseInput.value).toBe("origin/main"));
    expect(action().hasAttribute("disabled")).toBe(false);

    // Clearing the field disables the action rather than silently submitting
    // the suggestion behind the human's back.
    fireEvent.change(baseInput, { target: { value: "" } });
    expect(action().hasAttribute("disabled")).toBe(true);

    // Choosing the target again restores the visible suggestion, and clicking
    // submits exactly that value.
    fireEvent.change(select, { target: { value: "uncommitted" } });
    fireEvent.change(select, { target: { value: "branch" } });
    // The input unmounts with the target switch, so re-query it.
    const refilled = slot.getAllByLabelText(
      "Base branch",
    )[0]! as HTMLInputElement;
    await vi.waitFor(() => expect(refilled.value).toBe("origin/main"));
    fireEvent.click(action());
    await vi.waitFor(() => {
      expect(refreshCalls).toContainEqual({
        threadId: "thread-ui",
        target: { type: "branch_committed", mergeBaseBranch: "origin/main" },
      });
    });
    slot.lifecycle.unmount();
  });

  it("ignores a tour-section failure that lands after a revision switch", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const base = reviewFixture();
    const step = (id: string, title: string) => ({
      id,
      title,
      anchors: [],
      blocks: [{ kind: "narrative" as const, body: `${title} body.` }],
    });
    const tourFor = (reviewId: string) => ({
      reviewId,
      title: "Tour",
      overview: null,
      createdAt: 1,
      steps: [step("alpha", "Alpha"), step("beta", "Beta")],
      coverage: { totalChangedLines: 2, coveredChangedLines: 2, uncovered: [] },
    });
    const older = {
      ...base,
      id: "11111111-1111-4111-8111-1111111111aa",
      snapshot: "snapshot-old",
      reviewedSectionIds: ["alpha"],
      tour: tourFor("11111111-1111-4111-8111-1111111111aa"),
    };
    const newer = {
      ...base,
      id: "11111111-1111-4111-8111-1111111111bb",
      snapshot: "snapshot-new",
      // A new revision starts with no section marks.
      reviewedSectionIds: [],
      tour: tourFor("11111111-1111-4111-8111-1111111111bb"),
    };
    let rejectPending: ((cause: Error) => void) | undefined;
    let loaded = older;
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async (input: any) =>
            input?.reviewId === newer.id
              ? { review: newer }
              : { review: loaded },
          revisions: async () => ({
            revisions: [
              {
                id: newer.id,
                threadId: "thread-ui",
                snapshot: newer.snapshot,
                createdAt: 2,
                target: newer.target,
                fileCount: 1,
                annotationCount: 0,
                unresolvedCount: 0,
                viewedCount: 0,
              },
              {
                id: older.id,
                threadId: "thread-ui",
                snapshot: older.snapshot,
                createdAt: 1,
                target: older.target,
                fileCount: 1,
                annotationCount: 0,
                unresolvedCount: 0,
                viewedCount: 0,
              },
            ],
          }),
          reviewEnvironment: async () => baseSuggestionRpc(),
          setTourSectionReviewed: () =>
            new Promise((_resolve, reject) => {
              rejectPending = reject;
            }),
        } as any,
      },
    );
    fireEvent.click(await slot.findByRole("button", { name: "Tour" }));
    // Unmark alpha on the older revision and leave the request hanging.
    fireEvent.click(slot.getByRole("button", { name: "Section reviewed" }));
    await vi.waitFor(() =>
      expect(
        slot.getByRole("button", { name: "Mark section reviewed" }),
      ).toBeTruthy(),
    );
    // Switch revisions while the request is still in flight.
    loaded = newer;
    fireEvent.change(
      slot.getAllByRole("combobox", { name: "Review revision" })[0]!,
      { target: { value: newer.id } },
    );
    await vi.waitFor(() =>
      expect(slot.getByText("0 of 2 sections reviewed")).toBeTruthy(),
    );
    // The failure now belongs to the previous revision: it must not mark the
    // revision on screen, and it must not surface as its error.
    rejectPending!(new Error("Could not save tour progress."));
    await vi.waitFor(() =>
      expect(slot.getByText("0 of 2 sections reviewed")).toBeTruthy(),
    );
    expect(slot.queryByText("Could not save tour progress.")).toBeNull();
    expect(
      slot.getAllByRole("button", { name: "Mark section reviewed" }).length,
    ).toBeGreaterThan(0);
    slot.lifecycle.unmount();
  });

  it("keeps the file sheet reachable when a search matches nothing", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const review = {
      ...reviewFixture(),
      files: [
        ...reviewFixture().files,
        {
          ...reviewFixture().files[0]!,
          path: "docs/guide.md",
          patch: patch.replaceAll("src/example.ts", "docs/guide.md"),
        },
      ],
    };
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
        } as any,
      },
    );
    const trigger = await slot.findByLabelText("Changed file", { exact: true });
    fireEvent.click(trigger);
    fireEvent.change(slot.getByLabelText("Search files on mobile"), {
      target: { value: "nope" },
    });
    await vi.waitFor(() =>
      expect(trigger.textContent).toContain("No matching files"),
    );
    // Dismiss the sheet, then reopen it: with zero results the trigger used to
    // be inert, which stranded the search that emptied the list.
    fireEvent.click(trigger);
    expect(slot.queryByRole("dialog", { name: "Changed files" })).toBeNull();
    fireEvent.click(trigger);
    expect(slot.queryByRole("dialog", { name: "Changed files" })).toBeTruthy();
    fireEvent.change(slot.getByLabelText("Search files on mobile"), {
      target: { value: "guide" },
    });
    await vi.waitFor(() => {
      expect(openedFileRow(slot, "docs/guide.md")).toBeTruthy();
    });
    slot.lifecycle.unmount();
  });

  const twoFileReview = () => ({
    ...reviewFixture(),
    files: [
      ...reviewFixture().files,
      {
        ...reviewFixture().files[0]!,
        path: "docs/guide.md",
        patch: patch.replaceAll("src/example.ts", "docs/guide.md"),
      },
    ],
  });

  it("moves focus into the file sheet, keeps Tab inside, and restores focus", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review: twoFileReview() }),
          revisions: async () => ({ revisions: [] }),
        } as any,
      },
    );
    const trigger = await slot.findByLabelText("Changed file", { exact: true });
    trigger.focus();
    fireEvent.click(trigger);
    const sheet = await slot.findByRole("dialog", { name: "Changed files" });
    await vi.waitFor(() => expect(document.activeElement).toBe(sheet));
    // The sheet is modal: Tab from the last control wraps to the first.
    const focusable = Array.from(
      sheet.querySelectorAll<HTMLElement>("button, input, select"),
    );
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    last.focus();
    fireEvent.keyDown(sheet, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    first.focus();
    fireEvent.keyDown(sheet, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    // Escape dismisses and focus returns to the control that opened it.
    fireEvent.keyDown(sheet, { key: "Escape" });
    await vi.waitFor(() => {
      expect(slot.queryByRole("dialog", { name: "Changed files" })).toBeNull();
    });
    expect(document.activeElement).toBe(trigger);
    slot.lifecycle.unmount();
  });

  it("gives the compare sheet a close control, Escape, and focus return", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review: reviewFixture() }),
          revisions: async () => ({ revisions: [] }),
          reviewEnvironment: async () => baseSuggestionRpc(),
        } as any,
      },
    );
    const actions = await slot.findByLabelText("Review actions");
    fireEvent.click(actions);
    fireEvent.click(
      slot.getByRole("button", { name: "Change review target…" }),
    );
    const sheet = await slot.findByRole("dialog", {
      name: "Compare or refresh",
    });
    await vi.waitFor(() => expect(document.activeElement).toBe(sheet));
    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    await vi.waitFor(() => {
      expect(
        slot.queryByRole("dialog", { name: "Compare or refresh" }),
      ).toBeNull();
    });
    // Focus returns to the menu that opened it, not to the body.
    expect(document.activeElement).toBe(actions);
    // Escape works too.
    fireEvent.click(actions);
    fireEvent.click(
      slot.getByRole("button", { name: "Change review target…" }),
    );
    const reopened = await slot.findByRole("dialog", {
      name: "Compare or refresh",
    });
    fireEvent.keyDown(reopened, { key: "Escape" });
    await vi.waitFor(() => {
      expect(
        slot.queryByRole("dialog", { name: "Compare or refresh" }),
      ).toBeNull();
    });
    expect(document.activeElement).toBe(actions);
    slot.lifecycle.unmount();
  });

  it("closes the tour section picker once a section is chosen", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const base = reviewFixture();
    const step = (id: string, title: string) => ({
      id,
      title,
      anchors: [],
      blocks: [{ kind: "narrative" as const, body: `${title} body.` }],
    });
    const review = {
      ...base,
      tour: {
        reviewId: base.id,
        title: "Tour",
        overview: null,
        createdAt: 1,
        steps: [step("alpha", "Alpha"), step("beta", "Beta")],
        coverage: {
          totalChangedLines: 2,
          coveredChangedLines: 2,
          uncovered: [],
        },
      },
    };
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
        } as any,
      },
    );
    fireEvent.click(await slot.findByRole("button", { name: "Tour" }));
    const summary = slot.getByLabelText("Tour section progress");
    fireEvent.click(summary);
    const picker = summary.closest("details")!;
    expect(picker.open).toBe(true);
    fireEvent.click(
      within(picker as HTMLElement).getByRole("button", { name: "2. Beta" }),
    );
    expect(picker.open).toBe(false);
    slot.lifecycle.unmount();
  });

  it("reverts only the tour section whose save failed", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const base = reviewFixture();
    const step = (id: string, title: string) => ({
      id,
      title,
      anchors: [],
      blocks: [{ kind: "narrative" as const, body: `${title} body.` }],
    });
    const review = {
      ...base,
      reviewedSectionIds: [],
      tour: {
        reviewId: base.id,
        title: "Tour",
        overview: null,
        createdAt: 1,
        steps: [step("alpha", "Alpha"), step("beta", "Beta")],
        coverage: {
          totalChangedLines: 2,
          coveredChangedLines: 2,
          uncovered: [],
        },
      },
    };
    let rejectBeta: ((cause: Error) => void) | undefined;
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
          setTourSectionReviewed: async (input: any) => {
            if (input.stepId === "beta")
              return new Promise((_resolve, reject) => {
                rejectBeta = reject;
              });
            return { reviewed: input.reviewed, reviewedCount: 1 };
          },
        } as any,
      },
    );
    fireEvent.click(await slot.findByRole("button", { name: "Tour" }));
    // Alpha succeeds.
    fireEvent.click(
      slot.getByRole("button", { name: "Mark section reviewed" }),
    );
    await vi.waitFor(() => {
      expect(
        slot
          .getAllByRole("button", { name: "Section reviewed" })
          .some((button) => button.getAttribute("aria-pressed") === "true"),
      ).toBe(true);
    });
    // Beta fails while in flight: its own mark reverts, alpha's survives.
    fireEvent.click(slot.getByRole("button", { name: "Next tour section" }));
    await vi.waitFor(() =>
      expect(slot.getByText("Section 2 of 2 · Beta")).toBeTruthy(),
    );
    const betaToggle = slot.getByRole("button", {
      name: "Mark section reviewed",
    });
    fireEvent.click(betaToggle);
    await vi.waitFor(() =>
      expect(betaToggle.hasAttribute("disabled")).toBe(true),
    );
    rejectBeta!(new Error("Could not save tour progress."));
    await vi.waitFor(() => {
      expect(
        slot.getByRole("button", { name: "Mark section reviewed" }),
      ).toBeTruthy();
      expect(
        slot
          .getByText("1 of 2 sections reviewed")
          .closest('[aria-live="polite"]'),
      ).toBeTruthy();
    });
    slot.lifecycle.unmount();
  });

  it("offers one-click comparisons against the detected base", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const review = reviewFixture();
    const refreshCalls: any[] = [];
    let resolveRefresh: (() => void) | undefined;
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
          reviewEnvironment: async () => baseSuggestionRpc(),
          refreshReview: (input: any) => {
            refreshCalls.push(input);
            return new Promise((resolve) => {
              resolveRefresh = () => resolve({ review });
            });
          },
        } as any,
      },
    );
    const committed = await slot.findByRole("button", {
      name: "Committed vs origin/main",
    });
    fireEvent.click(committed);
    await vi.waitFor(() => {
      expect(refreshCalls).toContainEqual({
        threadId: "thread-ui",
        target: { type: "branch_committed", mergeBaseBranch: "origin/main" },
      });
    });
    // In flight: both presets are disabled, so a second click cannot stack a
    // second snapshot request on the first.
    const everything = slot.getByRole("button", {
      name: "Everything vs origin/main",
    });
    expect(committed.hasAttribute("disabled")).toBe(true);
    expect(everything.hasAttribute("disabled")).toBe(true);
    resolveRefresh!();
    await vi.waitFor(() =>
      expect(committed.hasAttribute("disabled")).toBe(false),
    );
    expect(everything.hasAttribute("disabled")).toBe(false);
    fireEvent.click(everything);
    await vi.waitFor(() => {
      expect(refreshCalls).toContainEqual({
        threadId: "thread-ui",
        target: { type: "all", mergeBaseBranch: "origin/main" },
      });
    });
    slot.lifecycle.unmount();
  });

  it("explains when no base branch can be detected", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review: reviewFixture() }),
          revisions: async () => ({ revisions: [] }),
          reviewEnvironment: async () => ({
            status: "unavailable" as const,
            reason: "The review target needs a git checkout.",
            branchName: null,
            baseBranch: null,
            defaultBranch: null,
            mergeBaseBranch: null,
            upstream: null,
            remoteDefault: null,
            suggestedBase: null,
            suggestionSource: null,
          }),
        } as any,
      },
    );
    const select = (
      await slot.findAllByRole("combobox", {
        name: "Review target",
      })
    )[0]!;
    fireEvent.change(select, { target: { value: "branch" } });
    expect(
      await slot.findByText("The review target needs a git checkout."),
    ).toBeTruthy();
    expect(slot.queryByRole("button", { name: /vs origin\/main/ })).toBeNull();
    slot.lifecycle.unmount();
  });

  it("offers the target controls when a thread has no review yet", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const review = reviewFixture();
    const refreshCalls: any[] = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review: null }),
          revisions: async () => ({ revisions: [] }),
          refreshReview: async (input: any) => {
            refreshCalls.push(input);
            return { review };
          },
        } as any,
      },
    );
    expect(await slot.findByText("No review yet for this thread")).toBeTruthy();
    // The phone menu names the same action, so it must actually open the
    // compare sheet on a thread that has no snapshot yet.
    fireEvent.click(slot.getByLabelText("Review actions"));
    fireEvent.click(slot.getByRole("button", { name: "Open a review…" }));
    expect(
      await slot.findByRole("dialog", { name: "Compare or refresh" }),
    ).toBeTruthy();
    // The start-a-review controls must be reachable without the header panel:
    // pick a target and open the snapshot from the empty state itself.
    expect(
      slot.getAllByRole("combobox", { name: "Review target" }).length,
    ).toBeGreaterThan(0);
    slot.getAllByRole("button", { name: "Open review" })[0]!.click();
    await vi.waitFor(() => {
      // No target means "uncommitted changes", the documented default.
      expect(refreshCalls).toContainEqual({ threadId: "thread-ui" });
    });
    slot.lifecycle.unmount();
  });

  const tourFileCountFixture = (anchoredPaths: string[]) => {
    const base = reviewFixture();
    const files = [
      ...base.files,
      {
        ...base.files[0]!,
        path: "docs/guide.md",
        patch: patch.replaceAll("src/example.ts", "docs/guide.md"),
      },
      {
        ...base.files[0]!,
        path: "src/other.ts",
        patch: patch.replaceAll("src/example.ts", "src/other.ts"),
      },
    ];
    const anchors = anchoredPaths.map((filePath) => ({
      filePath,
      side: "new" as const,
      startLine: 1,
      endLine: 1,
      valid: true,
      reason: null,
    }));
    return {
      ...base,
      files,
      tour: {
        reviewId: base.id,
        title: "Tour",
        overview: null,
        createdAt: 1,
        steps: [
          {
            id: "one",
            title: "One",
            anchors,
            blocks: [
              { kind: "narrative" as const, body: "Read these." },
              ...anchors.map((anchor) => ({
                kind: "diff" as const,
                anchor,
              })),
            ],
          },
        ],
        coverage: {
          totalChangedLines: 6,
          coveredChangedLines: anchoredPaths.length,
          uncovered: [],
        },
      },
    };
  };

  it("renders tour notes and the overview as markdown", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const base = reviewFixture();
    const review = {
      ...base,
      tour: {
        reviewId: base.id,
        title: "Tour",
        overview: "Covers `lib/tours.ts` and the **anchor** validation.",
        createdAt: 1,
        steps: [
          {
            id: "one",
            title: "One",
            anchors: [],
            blocks: [
              {
                kind: "narrative" as const,
                body: "Push notifications were entirely `event-driven`:\n\n- `interaction.pending`\n- `thread.idle`",
              },
            ],
          },
        ],
        coverage: {
          totalChangedLines: 2,
          coveredChangedLines: 2,
          uncovered: [],
        },
      },
    };
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
        } as any,
      },
    );
    fireEvent.click(await slot.findByRole("button", { name: "Tour" }));
    // Both the overview and the narrative body go through the host renderer
    // (the test stub marks it with data-testid="bb-markdown"), so markdown in
    // agent notes is no longer shown as literal asterisks and backticks.
    await vi.waitFor(() => {
      expect(slot.getAllByTestId("bb-markdown").length).toBe(2);
    });
    const rendered = slot
      .getAllByTestId("bb-markdown")
      .map((node) => node.textContent ?? "");
    expect(rendered[0]).toContain("`lib/tours.ts`");
    expect(rendered[1]).toContain("`event-driven`");
    expect(
      slot.getByText(/Push notifications were entirely `event-driven`:/),
    ).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("states how many changed files the tour covers, and stays quiet when it covers all", async () => {
    const app = await loadPluginApp(() => import("./app"));
    // A tour that anchors 1 of 3 changed files must say so, and offer the way
    // out. There is deliberately no changed-line ratio or coverage disclaimer.
    const partial = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        rpc: {
          review: async () => ({
            review: tourFileCountFixture(["src/example.ts"]),
          }),
          revisions: async () => ({ revisions: [] }),
        } as any,
      },
    );
    fireEvent.click(await partial.findByRole("button", { name: "Tour" }));
    expect(
      await partial.findByText("Tour covers 1 of 3 changed files."),
    ).toBeTruthy();
    expect(partial.queryByText(/anchored to tour excerpts/)).toBeNull();
    expect(partial.queryByText(/coverage is not a reading/)).toBeNull();
    expect(partial.queryByText("Raw changes outside the tour →")).toBeNull();
    // The offered action returns to the complete document.
    fireEvent.click(
      partial.getByRole("button", { name: "Review the rest in Files" }),
    );
    expect(
      partial
        .getByRole("button", { name: "Files" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    partial.lifecycle.unmount();

    // A complete tour says nothing at all.
    const complete = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        rpc: {
          review: async () => ({
            review: tourFileCountFixture([
              "src/example.ts",
              "docs/guide.md",
              "src/other.ts",
            ]),
          }),
          revisions: async () => ({ revisions: [] }),
        } as any,
      },
    );
    fireEvent.click(await complete.findByRole("button", { name: "Tour" }));
    await complete.findByText("Read these.");
    expect(complete.queryByText(/Tour covers/)).toBeNull();
    complete.lifecycle.unmount();
  });

  it("marks tour sections reviewed without touching file viewed state", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const base = reviewFixture();
    const step = (id: string, title: string) => ({
      id,
      title,
      anchors: [],
      blocks: [{ kind: "narrative" as const, body: `${title} body.` }],
    });
    const review = {
      ...base,
      reviewedSectionIds: [],
      tour: {
        reviewId: base.id,
        title: "Tour",
        overview: null,
        createdAt: 1,
        steps: [step("alpha", "Alpha"), step("beta", "Beta")],
        coverage: {
          totalChangedLines: 2,
          coveredChangedLines: 2,
          uncovered: [],
        },
      },
    };
    const reviewed: any[] = [];
    const viewed: any[] = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
          setTourSectionReviewed: async (input: any) => {
            reviewed.push(input);
            return { reviewed: input.reviewed, reviewedCount: 1 };
          },
          markFileViewed: async (input: any) => {
            viewed.push(input);
            return { viewedCount: 1 };
          },
        } as any,
      },
    );
    fireEvent.click(await slot.findByRole("button", { name: "Tour" }));
    expect(slot.getByText("0 of 2 sections reviewed")).toBeTruthy();
    const toggle = slot.getByRole("button", {
      name: "Mark section reviewed",
    });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    await vi.waitFor(() => expect(reviewed).toHaveLength(1));
    expect(reviewed[0]).toMatchObject({
      reviewId: review.id,
      stepId: "alpha",
      reviewed: true,
    });
    await vi.waitFor(() => {
      expect(
        slot
          .getByRole("button", { name: "Section reviewed" })
          .getAttribute("aria-pressed"),
      ).toBe("true");
      expect(slot.getByText("1 of 2 sections reviewed")).toBeTruthy();
    });
    // Section progress never marks files viewed.
    expect(viewed).toEqual([]);
    slot.lifecycle.unmount();
  });

  it("toggles diff line wrapping from the compact toolbar", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        rpc: {
          review: async () => ({ review: reviewFixture() }),
          revisions: async () => ({ revisions: [] }),
        } as any,
      },
    );
    const wrapToggles = await slot.findAllByRole("button", {
      name: "Wrap diff lines",
    });
    expect(wrapToggles.length).toBeGreaterThan(0);
    const wrapToggle = wrapToggles[0] as HTMLButtonElement;
    expect(wrapToggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(wrapToggle);
    expect(wrapToggle.getAttribute("aria-pressed")).toBe("true");
    expect(wrapToggle.getAttribute("aria-label")).toBe(
      "Disable diff line wrap",
    );
    slot.lifecycle.unmount();
  });

  it("jumps from a mobile tour step to its anchored diff file", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const base = reviewFixture();
    const review = {
      ...base,
      files: [
        ...base.files,
        {
          ...base.files[0],
          path: "docs/guide.md",
          patch: patch.replaceAll("src/example.ts", "docs/guide.md"),
        },
      ],
      tour: {
        reviewId: base.id,
        title: "Trace the guide update",
        overview: null,
        createdAt: 1,
        steps: [
          {
            id: "inspect-guide",
            title: "Inspect the guide",
            blocks: [
              { kind: "narrative", body: "Start with the new guide line." },
              {
                kind: "diff",
                anchor: {
                  filePath: "docs/guide.md",
                  side: "new",
                  startLine: 1,
                  endLine: 1,
                  valid: true,
                  reason: null,
                },
              },
            ],
            anchors: [
              {
                filePath: "docs/guide.md",
                side: "new",
                startLine: 1,
                endLine: 1,
                valid: true,
                reason: null,
              },
            ],
          },
        ],
        coverage: {
          totalChangedLines: 2,
          coveredChangedLines: 1,
          uncovered: [],
        },
      },
    };
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
        } as any,
      },
    );

    fireEvent.click(await slot.findByRole("button", { name: "Tour" }));
    fireEvent.click(await slot.findByRole("button", { name: "Full file →" }));
    fireEvent.click(slot.getByLabelText("Changed file", { exact: true }));
    await vi.waitFor(() => {
      expect(
        openedFileRow(slot, "docs/guide.md").getAttribute("aria-current"),
      ).toBe("true");
      expect(
        slot
          .getByRole("button", { name: "Files" })
          .getAttribute("aria-pressed"),
      ).toBe("true");
    });
    slot.lifecycle.unmount();
  });

  it("interleaves narrative and code-scoped comments without a tour rail", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const base = reviewFixture();
    const review = {
      ...base,
      files: [
        ...base.files,
        {
          ...base.files[0]!,
          path: "docs/guide.md",
          patch: patch.replaceAll("src/example.ts", "docs/guide.md"),
        },
      ],
      annotations: [
        {
          id: "33333333-3333-4333-8333-333333333331",
          filePath: "docs/guide.md",
          side: "new",
          startLine: 1,
          endLine: 1,
          body: "Check how the guide describes this change.",
          createdAt: 1,
          sentAt: null,
          resolvedAt: null,
          author: "human",
          parentId: null,
          fileLevel: false,
          carriedFromAnnotationId: null,
          resolutionSuggestion: null,
        },
        {
          id: "33333333-3333-4333-8333-333333333332",
          filePath: "docs/guide.md",
          side: "new",
          startLine: 1,
          endLine: 1,
          body: "I'll clarify that wording.",
          createdAt: 2,
          sentAt: null,
          resolvedAt: null,
          author: "agent",
          parentId: "33333333-3333-4333-8333-333333333331",
          fileLevel: false,
          carriedFromAnnotationId: null,
          resolutionSuggestion: null,
        },
        {
          id: "33333333-3333-4333-8333-333333333333",
          filePath: "src/example.ts",
          side: "new",
          startLine: 1,
          endLine: 1,
          body: "This belongs to another step.",
          createdAt: 3,
          sentAt: null,
          resolvedAt: null,
          author: "human",
          parentId: null,
          fileLevel: false,
          carriedFromAnnotationId: null,
          resolutionSuggestion: null,
        },
      ],
      tour: {
        reviewId: base.id,
        title: "Review the guide change",
        overview: "Follow this step and its anchored discussion.",
        createdAt: 1,
        steps: [
          {
            id: "inspect-guide",
            title: "Inspect the guide",
            blocks: [
              {
                kind: "narrative",
                body: "Start with the changed description.",
              },
              {
                kind: "diff",
                anchor: {
                  filePath: "docs/guide.md",
                  side: "new",
                  startLine: 1,
                  endLine: 1,
                  valid: true,
                  reason: null,
                },
              },
            ],
            anchors: [
              {
                filePath: "docs/guide.md",
                side: "new",
                startLine: 1,
                endLine: 1,
                valid: true,
                reason: null,
              },
            ],
          },
        ],
        coverage: {
          totalChangedLines: 2,
          coveredChangedLines: 1,
          uncovered: [],
        },
      },
    };
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
        } as any,
      },
    );

    await slot.findByRole("navigation", { name: "Changed files" });
    fireEvent.click(slot.getByRole("button", { name: "Tour" }));
    const document = within(
      slot.getByRole("region", { name: "Review document" }),
    );
    expect(
      slot.queryByRole("complementary", { name: "Review tour" }),
    ).toBeNull();
    expect(
      document.getByText("Start with the changed description."),
    ).toBeTruthy();
    expect(
      document.getByText("Check how the guide describes this change."),
    ).toBeTruthy();
    expect(document.getByText("I'll clarify that wording.")).toBeTruthy();
    expect(document.queryByText("This belongs to another step.")).toBeNull();
    // The tour's remaining-changes line is covered by its own test; here the
    // assertion is only that the tour body rendered before navigating away.
    fireEvent.click(document.getByRole("button", { name: "Full file →" }));
    fireEvent.click(slot.getByLabelText("Changed file", { exact: true }));
    await vi.waitFor(() => {
      expect(
        openedFileRow(slot, "docs/guide.md").getAttribute("aria-current"),
      ).toBe("true");
    });
    slot.lifecycle.unmount();
  });

  it("filters mobile file navigation without hiding the review document", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const review = {
      ...reviewFixture(),
      files: [
        ...reviewFixture().files,
        {
          ...reviewFixture().files[0],
          path: "docs/guide.md",
          patch: patch.replaceAll("src/example.ts", "docs/guide.md"),
        },
      ],
      annotations: [
        {
          id: "22222222-2222-4222-8222-222222222221",
          filePath: "src/example.ts",
          side: "new",
          startLine: 1,
          endLine: 1,
          body: "inline root",
          createdAt: 1,
          sentAt: null,
          resolvedAt: null,
          author: "human",
          parentId: null,
          fileLevel: false,
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          filePath: "src/example.ts",
          side: "new",
          startLine: 1,
          endLine: 1,
          body: "reply",
          createdAt: 2,
          sentAt: null,
          resolvedAt: null,
          author: "human",
          parentId: "22222222-2222-4222-8222-222222222221",
          fileLevel: false,
        },
        {
          id: "22222222-2222-4222-8222-222222222223",
          filePath: "docs/guide.md",
          side: "new",
          startLine: 0,
          endLine: 0,
          body: "file root",
          createdAt: 3,
          sentAt: null,
          resolvedAt: null,
          author: "human",
          parentId: null,
          fileLevel: true,
        },
      ],
    } as any;
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
        } as any,
      },
    );

    const fileSummary = await slot.findByLabelText("Changed file", {
      exact: true,
    });
    // Filters and search live inside the file sheet now.
    fireEvent.click(fileSummary);
    fireEvent.change(slot.getAllByLabelText("Changed file filter")[0]!, {
      target: { value: "with-open-comments" },
    });
    await vi.waitFor(() => {
      expect(openedFileRow(slot, "src/example.ts")).toBeTruthy();
      expect(openedFileRow(slot, "docs/guide.md")).toBeTruthy();
    });
    expect(
      within(openedFileRow(slot, "src/example.ts")).getByLabelText(
        "1 open comment threads",
      ),
    ).toBeTruthy();
    expect(
      within(openedFileRow(slot, "docs/guide.md")).getByLabelText(
        "1 open comment threads",
      ),
    ).toBeTruthy();

    fireEvent.change(slot.getByLabelText("Search files on mobile"), {
      target: { value: "not-present" },
    });
    await vi.waitFor(() => {
      expect(fileSummary.textContent).toContain("No matching files");
    });
    expect(slot.getAllByText("No matching files.").length).toBeGreaterThan(0);

    fireEvent.change(slot.getByLabelText("Search files on mobile"), {
      target: { value: "src" },
    });
    await vi.waitFor(() => {
      expect(
        openedFileRow(slot, "src/example.ts").getAttribute("aria-current"),
      ).toBe("true");
    });
    expect(
      slot.queryByRole("button", { name: "Open docs/guide.md" }),
    ).toBeNull();
    slot.getByRole("button", { name: "Viewed & next" }).click();
    await vi.waitFor(() => {
      expect(
        openedFileRow(slot, "src/example.ts").getAttribute("aria-current"),
      ).toBe("true");
    });
    slot.lifecycle.unmount();
  });

  it("adds and shows a file-level comment", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const review = reviewFixture();
    const added = {
      id: "33333333-3333-4333-8333-333333333331",
      filePath: "src/example.ts",
      side: "new",
      startLine: 0,
      endLine: 0,
      body: "file note text",
      createdAt: 1,
      sentAt: null,
      resolvedAt: null,
      author: "human",
      parentId: null,
      fileLevel: true,
      carriedFromAnnotationId: null,
      resolutionSuggestion: null,
    };
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
          addAnnotation: async () => ({ annotation: added }),
        } as any,
      },
    );

    const moreSummary = await slot.findByText("More");
    fireEvent.click(moreSummary);
    const open = within(moreSummary.closest("details")!).getByRole("button", {
      name: "Comment on file",
    });
    open.click();
    const textarea = await slot.findByLabelText("File comment");
    textarea.focus();
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    setter.call(textarea, "file note text");
    textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
    slot.getByRole("button", { name: "Add comment" }).click();
    await vi.waitFor(() => {
      expect(slot.inspection.rpcCalls).toContainEqual({
        method: "addAnnotation",
        input: {
          reviewId: review.id,
          filePath: "src/example.ts",
          body: "file note text",
          fileLevel: true,
        },
      });
    });
    slot.lifecycle.unmount();
  });
});
describe("comment list behavior", () => {
  it("collapses resolved comments and never shows a selection checkbox", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const review = {
      ...reviewFixture(),
      annotations: [
        {
          id: "22222222-2222-4222-8222-222222222221",
          filePath: "src/example.ts",
          side: "new",
          startLine: 1,
          endLine: 1,
          body: "resolved human comment",
          createdAt: 1,
          sentAt: null,
          resolvedAt: 2,
          author: "human",
          carriedFromAnnotationId: null,
          resolutionSuggestion: null,
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          filePath: "src/example.ts",
          side: "new",
          startLine: 2,
          endLine: 2,
          body: "agent observation",
          createdAt: 3,
          sentAt: null,
          resolvedAt: null,
          author: "agent",
          carriedFromAnnotationId: null,
          resolutionSuggestion: null,
        },
      ],
    } as any;
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({
            revisions: [
              {
                id: review.id,
                threadId: review.threadId,
                snapshot: review.snapshot,
                createdAt: review.createdAt,
                target: { type: "uncommitted" },
                fileCount: 1,
                annotationCount: 2,
                unresolvedCount: 1,
                viewedCount: 0,
              },
            ],
          }),
        } as any,
      },
    );

    // Resolved comment renders collapsed: no checkbox until expanded.
    const feedbackTrigger = (
      await slot.findAllByRole("button", {
        name: "Review feedback, 0 pending/unsent comments",
      })
    )[0]!;
    fireEvent.click(feedbackTrigger);
    const dialog = await slot.findByRole("dialog");
    // Resolved threads now sit behind one disclosure; open it to reach them.
    fireEvent.click(
      within(dialog).getByRole("button", { name: /Resolved \(\d+\)/ }),
    );
    await within(dialog).findByRole("button", {
      name: "Show src/example.ts:1 (new)",
    });
    // Resolved and agent comments carry no checkbox at all: nothing in the
    // drawer is individually selectable any more.
    expect(within(dialog).queryAllByRole("checkbox")).toHaveLength(0);
    within(dialog)
      .getByRole("button", { name: "Show src/example.ts:1 (new)" })
      .click();
    await vi.waitFor(() =>
      expect(within(dialog).getByText("✓ resolved")).toBeTruthy(),
    );
    expect(within(dialog).queryAllByRole("checkbox")).toHaveLength(0);

    // Agent comment shows the agent chip, and is never part of a batch.
    expect(within(dialog).getByText("AI comment")).toBeTruthy();

    // Only the agent comment is unresolved, but agent comments are never
    // pending, so there is nothing to send.
    expect(within(dialog).queryByText(/1 pending comment/)).toBeNull();
    slot.lifecycle.unmount();
  });
});

describe("comment locate flow", () => {
  function locateFixture() {
    const review = reviewFixture();
    return {
      ...review,
      files: [
        ...review.files,
        {
          ...review.files[0],
          path: "src/other.ts",
          patch: patch.replaceAll("src/example.ts", "src/other.ts"),
        },
      ],
      viewedPaths: ["src/example.ts"],
      annotations: [
        {
          id: "55555555-5555-4555-8555-555555555551",
          filePath: "src/example.ts",
          side: "new",
          startLine: 1,
          endLine: 1,
          body: "locate me",
          createdAt: 1,
          sentAt: null,
          resolvedAt: null,
          author: "human",
          parentId: null,
          fileLevel: false,
          carriedFromAnnotationId: null,
          resolutionSuggestion: null,
        },
      ],
    } as any;
  }

  it("locates filtered comments from the feedback drawer and restores the diff", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review: locateFixture() }),
          revisions: async () => ({
            revisions: [
              {
                id: "latest-review",
                threadId: "thread-ui",
                snapshot: "latest-snapshot",
                createdAt: 2,
                target: { type: "uncommitted" },
                fileCount: 2,
                annotationCount: 1,
                unresolvedCount: 1,
                viewedCount: 0,
              },
              {
                id: locateFixture().id,
                threadId: "thread-ui",
                snapshot: locateFixture().snapshot,
                createdAt: 1,
                target: { type: "uncommitted" },
                fileCount: 2,
                annotationCount: 1,
                unresolvedCount: 1,
                viewedCount: 0,
              },
            ],
          }),
        } as any,
      },
    );
    Element.prototype.scrollIntoView = vi.fn();
    await slot.findByRole("status", { name: "Stale review revision" });
    expect(slot.queryByRole("dialog")).toBeNull();
    // Filters and search live inside the file sheet now.
    fireEvent.click(slot.getByLabelText("Changed file", { exact: true }));
    fireEvent.change(slot.getAllByLabelText("Changed file filter")[0]!, {
      target: { value: "unviewed" },
    });
    fireEvent.change(slot.getByLabelText("Search files on mobile"), {
      target: { value: "other" },
    });
    await vi.waitFor(() => {
      expect(openedFileRow(slot, "src/other.ts")).toBeTruthy();
    });
    fireEvent.click(
      (
        await slot.findAllByRole("button", {
          name: "Review feedback, 1 pending/unsent comments",
        })
      )[1]!,
    );
    const dialog = await slot.findByRole("dialog");
    const locateButton = await within(dialog).findByRole("button", {
      name: "Show src/example.ts:1 (new) in diff",
    });
    fireEvent.click(locateButton);
    await vi.waitFor(() => {
      expect(slot.queryByRole("dialog")).toBeNull();
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });
    // Locating closes the file sheet; reopening shows the cleared filters.
    fireEvent.click(slot.getByLabelText("Changed file", { exact: true }));
    await vi.waitFor(() => {
      expect(
        openedFileRow(slot, "src/example.ts").getAttribute("aria-current"),
      ).toBe("true");
    });
    expect(
      (slot.getByLabelText("Search files on mobile") as HTMLInputElement).value,
    ).toBe("");
    expect(
      (slot.getAllByLabelText("Changed file filter")[0] as HTMLSelectElement)
        .value,
    ).toBe("all");
    expect(
      slot.getByRole("status", { name: "Stale review revision" }),
    ).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("keeps polling when the diff card renders late (file switch)", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review: locateFixture() }),
          revisions: async () => ({ revisions: [] }),
        } as any,
      },
    );
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    fireEvent.click(
      (
        await slot.findAllByRole("button", {
          name: "Review feedback, 1 pending/unsent comments",
        })
      )[0]!,
    );
    await slot.findByRole("dialog");
    const locateButton = await slot.findByRole("button", {
      name: "Show src/example.ts:1 (new) in diff",
    });
    // Simulate Pierre's late render: the annotation card appears only after
    // the first poll intervals would have passed (the old 3-attempt fix
    // failed here because it stopped at 180ms).
    const marker = document.createElement("div");
    marker.setAttribute(
      "data-annotation-id",
      "55555555-5555-4555-8555-555555555551",
    );
    marker.scrollIntoView = scrollIntoView;
    setTimeout(() => {
      document.body.appendChild(marker);
    }, 400);
    locateButton.click();
    await vi.waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalled();
    });
    slot.lifecycle.unmount();
  });
});

describe("review target picker (specific commit)", () => {
  it("requires a sha and passes the commit target to refresh", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const review = reviewFixture();
    const refreshCalls: any[] = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "review/thread-ui" },
      {
        context: { projectId: "project-ui", threadId: "thread-ui" },
        rpc: {
          review: async () => ({ review }),
          revisions: async () => ({ revisions: [] }),
          refreshReview: async (input: any) => {
            refreshCalls.push(input);
            return {
              review: {
                ...review,
                id: "22222222-2222-4222-8222-222222222222",
                snapshot: "commit-ui",
              },
            };
          },
        } as any,
      },
    );

    await slot.findByTestId("pierre-diff");
    fireEvent.click(slot.getByText("Compare / refresh"));
    const select = slot.getAllByRole("combobox", { name: "Review target" })[0]!;
    fireEvent.change(select, { target: { value: "commit" } });
    const reviewButton = slot.getByRole("button", { name: "Review commit" });
    // no sha yet -> the button must not silently fall back to uncommitted
    expect(reviewButton.hasAttribute("disabled")).toBe(true);
    fireEvent.change(slot.getByLabelText("Commit sha"), {
      target: { value: "846e364c9db491759b7f391cd1ebb622e943badc" },
    });
    expect(reviewButton.hasAttribute("disabled")).toBe(false);
    reviewButton.click();
    await vi.waitFor(() => {
      expect(refreshCalls).toContainEqual({
        threadId: "thread-ui",
        target: {
          type: "commit",
          sha: "846e364c9db491759b7f391cd1ebb622e943badc",
        },
      });
    });
    slot.lifecycle.unmount();
  });
});

describe("thread header action (compact viewport)", () => {
  it("renders an icon control that opens the full review panel", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const headerAction = app.threadHeaderActions[0]!;
    const slot = renderSlot(headerAction, {
      threadId: "thread-ui",
      projectId: "project-ui",
      isCompactViewport: true,
    });

    const button = await slot.findByRole("button", {
      name: "Open Review Workspace",
    });
    button.click();
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "review",
      options: { subPath: "review/thread-ui" },
    });
    slot.lifecycle.unmount();
  });
});
