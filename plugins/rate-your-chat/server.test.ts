import { afterEach, describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  makePluginAgentConfigurationContext,
  makeThreadResponse,
  experimental_scanPublicSdkOnly,
} from "@get-bb/plugin-sdk/testing";
import { fileURLToPath } from "node:url";
import plugin from "./server";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const thread = makeThreadResponse({
  id: "thr_test",
  projectId: "proj_test",
  providerId: "pi",
  title: "Example chat",
  archivedAt: 1000,
});
async function setup(extraThreads: Record<string, typeof thread> = {}) {
  const threads = { [thread.id]: thread, ...extraThreads };
  const host = createFakePluginHost({
    pluginId: "rate-your-chat",
    sdk: {
      threads: {
        get: async ({ threadId }) => {
          const found = threads[threadId];
          if (!found)
            throw Object.assign(new Error("Thread not found"), {
              status: 404,
              code: "thread_not_found",
            });
          return found;
        },
        events: {
          list: async (args) => {
            if (args.afterSeq === "1") return [];
            return [
              {
                id: "e1",
                threadId: thread.id,
                scope: { kind: "thread" },
                seq: 1,
                createdAt: 500,
                type: "client/turn/requested",
                data: {
                  execution: { model: "local/model-a", reasoningLevel: "high" },
                  input: ["private text"],
                },
              },
            ];
          },
        },
      },
    },
  });
  await plugin(host.bb);
  cleanups.push(() => host.harness.lifecycle.dispose());
  return host;
}
const save = {
  threadId: thread.id,
  archivedAt: 1000,
  expectedRevision: null,
  score: 4,
  useCases: ["coding"],
  note: "Worked well",
};

describe("archive feedback", () => {
  it("only queues on archive, not creation, idle, or active; hidden threads are ignored", async () => {
    const { harness } = await setup();
    await harness.behavior.emitThreadEvent("thread.created", { thread });
    await harness.behavior.emitThreadEvent("thread.idle", {
      thread,
      lastAssistantText: "do not collect",
    });
    expect(await harness.behavior.callRpc("pending", null)).toEqual({
      prompt: null,
      count: 0,
    });
    await harness.behavior.emitThreadEvent("thread.archived", {
      thread: { ...thread, visibility: "hidden" },
    });
    expect(await harness.behavior.callRpc("pending", null)).toEqual({
      prompt: null,
      count: 0,
    });
    await harness.behavior.emitThreadEvent("thread.archived", { thread });
    expect(await harness.behavior.callRpc("pending", null)).toEqual({
      prompt: { threadId: thread.id, title: thread.title, archivedAt: 1000 },
      count: 1,
    });
    expect(harness.inspection.sdk.callsTo("threads.get")).toHaveLength(1);
    expect(harness.inspection.sdk.callsTo("threads.events.list")).toHaveLength(
      0,
    );
  });
  it("saves the whole-chat rating with sanitized execution history and clears the prompt", async () => {
    const { harness } = await setup();
    await harness.behavior.emitThreadEvent("thread.archived", { thread });
    const rating = await harness.behavior.callRpc("savePrompt", save);
    expect(rating).toMatchObject({
      score: 4,
      revision: 1,
      providerId: "pi",
      history: {
        observations: [{ model: "local/model-a", reasoningLevel: "high" }],
      },
    });
    expect(JSON.stringify(rating)).not.toContain("private text");
    expect(await harness.behavior.callRpc("pending", null)).toEqual({
      prompt: null,
      count: 0,
    });
    expect(
      harness.inspection.sdk.callsTo("threads.events.list")[0]?.[0],
    ).toMatchObject({
      types: [
        "client/turn/requested",
        "client/turn/rejected",
        "client/thread/start",
        "client/turn/start",
        "provider/modelFallback",
      ],
    });
    expect(harness.inspection.sdk.callsTo("threads.send")).toHaveLength(0);
    expect(harness.inspection.sdk.callsTo("providers.models")).toHaveLength(0);
  });
  it("skip/unarchive/delete clear only prompts, saved feedback survives reload/archive/delete", async () => {
    const { harness } = await setup();
    await harness.behavior.emitThreadEvent("thread.archived", { thread });
    await harness.behavior.callRpc("savePrompt", save);
    const next = (await harness.lifecycle.reload(plugin)).harness;
    cleanups.unshift(() => next.lifecycle.dispose());
    expect(
      await next.behavior.callRpc("getRating", { threadId: thread.id }),
    ).toMatchObject({ score: 4 });
    await next.behavior.emitThreadEvent("thread.archived", {
      thread: { ...thread, archivedAt: 2000 },
    });
    expect(
      await next.behavior.callRpc("dismiss", {
        threadId: thread.id,
        archivedAt: 1000,
      }),
    ).toEqual({ removed: false });
    await next.behavior.emitThreadEvent("thread.unarchived", { thread });
    await next.behavior.emitThreadEvent("thread.deleted", { thread });
    expect(
      await next.behavior.callRpc("getRating", { threadId: thread.id }),
    ).toMatchObject({ score: 4 });
  });
  it("retains skipped state across reload and prompts again on a new archive", async () => {
    const { harness } = await setup();
    await harness.behavior.emitThreadEvent("thread.archived", { thread });
    await harness.behavior.callRpc("dismiss", {
      threadId: thread.id,
      archivedAt: 1000,
    });
    const next = (await harness.lifecycle.reload(plugin)).harness;
    cleanups.unshift(() => next.lifecycle.dispose());
    expect(await next.behavior.callRpc("pending", null)).toEqual({
      prompt: null,
      count: 0,
    });
    await next.behavior.emitThreadEvent("thread.archived", {
      thread: { ...thread, archivedAt: 2000 },
    });
    next.inspection.sdk.stub("threads.get", async () => ({
      ...thread,
      archivedAt: 2000,
    }));
    expect(await next.behavior.callRpc("pending", null)).toMatchObject({
      count: 1,
    });
  });
  it("validates inputs and rejects stale edits/deletes; edits don't rescan history", async () => {
    const { harness } = await setup();
    await harness.behavior.emitThreadEvent("thread.archived", { thread });
    await expect(
      harness.behavior.callRpc("savePrompt", { ...save, score: 8 }),
    ).rejects.toThrow();
    await expect(
      harness.behavior.callRpc("savePrompt", {
        ...save,
        note: "x".repeat(4001),
      }),
    ).rejects.toThrow();
    await expect(
      harness.behavior.callRpc("savePrompt", { ...save, useCases: [] }),
    ).rejects.toThrow();
    await expect(
      harness.behavior.callRpc("savePrompt", {
        ...save,
        useCases: ["coding", "coding"],
      }),
    ).rejects.toThrow();
    await harness.behavior.callRpc("savePrompt", save);
    const reads = harness.inspection.sdk.calls.length;
    const edited = await harness.behavior.callRpc("editRating", {
      threadId: thread.id,
      score: 5,
      useCases: ["coding", "review"],
      note: save.note,
      expectedRevision: 1,
    });
    expect(edited).toMatchObject({
      revision: 2,
      score: 5,
      useCases: ["coding", "review"],
    });
    expect(harness.inspection.sdk.calls).toHaveLength(reads);
    await expect(
      harness.behavior.callRpc("deleteRating", {
        threadId: thread.id,
        expectedRevision: 1,
      }),
    ).rejects.toThrow(/changed/);
    await expect(
      harness.behavior.callRpc("editRating", {
        threadId: thread.id,
        expectedRevision: 1,
        score: 2,
        useCases: ["other"],
        note: "stale",
      }),
    ).rejects.toThrow(/changed/);
    expect(await harness.behavior.callRpc("list", { offset: 0 })).toMatchObject(
      {
        total: 1,
        ratings: [{ score: 5, variations: [{ model: "local/model-a" }] }],
      },
    );
    expect(
      await harness.behavior.callRpc("exportPage", { afterThreadId: "" }),
    ).toMatchObject({
      rating: {
        score: 5,
        history: { observations: [{ model: "local/model-a" }] },
      },
    });
    expect(
      await harness.behavior.callRpc("deleteRating", {
        threadId: thread.id,
        expectedRevision: 2,
      }),
    ).toEqual({ removed: true });
    expect(
      await harness.behavior.callRpc("exportPage", { afterThreadId: "" }),
    ).toEqual({ rating: null });
  });
  it("does not save if history fails or the chat is unarchived", async () => {
    const { harness } = await setup();
    await harness.behavior.emitThreadEvent("thread.archived", { thread });
    harness.inspection.sdk.stub("threads.events.list", async () => {
      throw new Error("history offline");
    });
    await expect(harness.behavior.callRpc("savePrompt", save)).rejects.toThrow(
      /history offline/,
    );
    expect(
      await harness.behavior.callRpc("getRating", { threadId: thread.id }),
    ).toBe(null);
    expect(await harness.behavior.callRpc("pending", null)).toMatchObject({
      count: 1,
    });
    harness.inspection.sdk.stub("threads.get", async () => ({
      ...thread,
      archivedAt: null,
    }));
    await expect(harness.behavior.callRpc("savePrompt", save)).rejects.toThrow(
      /no longer archived/,
    );
  });
  it("does not resurrect a prompt skipped while history was being read", async () => {
    const { bb, harness } = await setup();
    await harness.behavior.emitThreadEvent("thread.archived", { thread });
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    harness.inspection.sdk.stub("threads.events.list", async () => {
      entered();
      await gate;
      return [];
    });
    const saving = harness.behavior.callRpc("savePrompt", save);
    const rejected = expect(saving).rejects.toThrow(/dismissed or changed/);
    await reading;
    await harness.behavior.callRpc("dismiss", {
      threadId: thread.id,
      archivedAt: 1000,
    });
    release();
    await rejected;
    expect(
      bb.storage.database().prepare("SELECT * FROM ratings").all(),
    ).toEqual([]);
    expect(
      bb.storage.database().prepare("SELECT * FROM observations").all(),
    ).toEqual([]);
  });
  it("only commits one of two concurrent saves for the same archive", async () => {
    const { bb, harness } = await setup();
    await harness.behavior.emitThreadEvent("thread.archived", { thread });
    const results = await Promise.allSettled([
      harness.behavior.callRpc("savePrompt", save),
      harness.behavior.callRpc("savePrompt", { ...save, score: 2 }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(
      bb.storage.database().prepare("SELECT revision FROM ratings").all(),
    ).toEqual([{ revision: 1 }]);
    expect(await harness.behavior.callRpc("pending", null)).toEqual({
      prompt: null,
      count: 0,
    });
  });
  it("refreshes capture on rearchive, preserving creation time and removing old SQL observations", async () => {
    const { bb, harness } = await setup();
    await harness.behavior.emitThreadEvent("thread.archived", { thread });
    const first = (await harness.behavior.callRpc("savePrompt", save)) as {
      createdAt: number;
    };
    harness.inspection.sdk.stub("threads.get", async () => ({
      ...thread,
      archivedAt: 2000,
    }));
    harness.inspection.sdk.stub("threads.events.list", async () => [
      {
        seq: 30,
        createdAt: 1500,
        type: "client/turn/requested",
        data: { execution: { model: "local/model-b", reasoningLevel: "low" } },
      },
    ]);
    await harness.behavior.emitThreadEvent("thread.archived", {
      thread: { ...thread, archivedAt: 2000 },
    });
    const second = await harness.behavior.callRpc("savePrompt", {
      ...save,
      expectedRevision: 1,
      archivedAt: 2000,
    });
    expect(second).toMatchObject({
      createdAt: first.createdAt,
      revision: 2,
      history: {
        observations: [{ model: "local/model-b", reasoningLevel: "low" }],
      },
    });
    expect(
      bb.storage
        .database()
        .prepare("SELECT model, reasoning_level FROM observations")
        .all(),
    ).toEqual([{ model: "local/model-b", reasoning_level: "low" }]);
    await harness.behavior.callRpc("deleteRating", {
      threadId: thread.id,
      expectedRevision: 2,
    });
    expect(
      bb.storage.database().prepare("SELECT * FROM observations").all(),
    ).toEqual([]);
    expect(
      bb.storage.database().prepare("SELECT * FROM ratings").all(),
    ).toEqual([]);
  });
  it("queues cascade archives in archive order and persists pending prompts across reload", async () => {
    const { harness } = await setup();
    await harness.behavior.emitThreadEvent("thread.archived", {
      thread: { ...thread, id: "thr_later", archivedAt: 2000 },
    });
    await harness.behavior.emitThreadEvent("thread.archived", { thread });
    const next = (await harness.lifecycle.reload(plugin)).harness;
    cleanups.unshift(() => next.lifecycle.dispose());
    expect(await next.behavior.callRpc("pending", null)).toMatchObject({
      prompt: { threadId: thread.id },
      count: 2,
    });
    await next.behavior.callRpc("dismiss", {
      threadId: thread.id,
      archivedAt: 1000,
    });
    next.inspection.sdk.stub("threads.get", async () => ({
      ...thread,
      id: "thr_later",
      archivedAt: 2000,
    }));
    expect(await next.behavior.callRpc("pending", null)).toMatchObject({
      prompt: { threadId: "thr_later" },
      count: 1,
    });
  });
  it("never reuses revisions after deletion, recreation, and reload", async () => {
    const { harness } = await setup();
    await harness.behavior.emitThreadEvent("thread.archived", { thread });
    await harness.behavior.callRpc("savePrompt", save);
    await harness.behavior.callRpc("deleteRating", {
      threadId: thread.id,
      expectedRevision: 1,
    });
    const next = (await harness.lifecycle.reload(plugin)).harness;
    cleanups.unshift(() => next.lifecycle.dispose());
    await next.behavior.emitThreadEvent("thread.archived", { thread });
    expect(await next.behavior.callRpc("savePrompt", save)).toMatchObject({
      revision: 2,
    });
    await expect(
      next.behavior.callRpc("editRating", {
        threadId: thread.id,
        expectedRevision: 1,
        score: 1,
        useCases: ["other"],
        note: "Stale editor",
      }),
    ).rejects.toThrow(/changed/);
    await expect(
      next.behavior.callRpc("deleteRating", {
        threadId: thread.id,
        expectedRevision: 1,
      }),
    ).rejects.toThrow(/changed/);
    expect(
      await next.behavior.callRpc("getRating", { threadId: thread.id }),
    ).toMatchObject({ revision: 2, score: 4 });
  });
  it("allocates revisions above pre-existing records", async () => {
    const { bb, harness } = await setup();
    await harness.behavior.emitThreadEvent("thread.archived", { thread });
    const first = (await harness.behavior.callRpc(
      "savePrompt",
      save,
    )) as Record<string, unknown>;
    bb.storage
      .database()
      .prepare(
        "UPDATE ratings SET revision = ?, record = ? WHERE thread_id = ?",
      )
      .run(50, JSON.stringify({ ...first, revision: 50 }), thread.id);
    const next = await harness.behavior.callRpc("editRating", {
      threadId: thread.id,
      expectedRevision: 50,
      score: 5,
      useCases: ["coding"],
      note: "Updated",
    });
    expect(next).toMatchObject({ revision: 51 });
  });
  it("reads legacy single-purpose records as one-element use cases", async () => {
    const { bb, harness } = await setup();
    await harness.behavior.emitThreadEvent("thread.archived", { thread });
    const saved = (await harness.behavior.callRpc(
      "savePrompt",
      save,
    )) as Record<string, unknown>;
    const legacy = { ...saved };
    delete legacy.useCases;
    bb.storage
      .database()
      .prepare("UPDATE ratings SET record = ? WHERE thread_id = ?")
      .run(JSON.stringify({ ...legacy, useCase: "review" }), thread.id);
    expect(
      await harness.behavior.callRpc("getRating", { threadId: thread.id }),
    ).toMatchObject({ useCases: ["review"] });
    expect(await harness.behavior.callRpc("list", { offset: 0 })).toMatchObject(
      { ratings: [{ useCases: ["review"] }] },
    );
  });
  it.each([
    { name: "unarchive", overrides: { archivedAt: null } },
    { name: "delete", overrides: { deletedAt: 2000 } },
    { name: "hide", overrides: { visibility: "hidden" } },
    { name: "newer archive", overrides: { archivedAt: 2000 } },
  ])(
    "prunes a prompt after a missed $name event without deleting feedback",
    async ({ overrides }) => {
      const { harness } = await setup();
      await harness.behavior.emitThreadEvent("thread.archived", { thread });
      await harness.behavior.callRpc("savePrompt", save);
      await harness.behavior.emitThreadEvent("thread.archived", { thread });
      const next = (await harness.lifecycle.reload(plugin)).harness;
      cleanups.unshift(() => next.lifecycle.dispose());
      next.inspection.sdk.stub("threads.get", async () => ({
        ...thread,
        ...overrides,
      }));
      expect(await next.behavior.callRpc("pending", null)).toEqual({
        prompt: null,
        count: 0,
      });
      expect(
        await next.behavior.callRpc("getRating", { threadId: thread.id }),
      ).toMatchObject({ score: 4 });
      expect(next.inspection.sdk.callsTo("threads.events.list")).toHaveLength(
        0,
      );
    },
  );
  it("prunes confirmed missing threads but retains prompts on transient or ambiguous lookup failures", async () => {
    const { bb, harness } = await setup();
    await harness.behavior.emitThreadEvent("thread.archived", { thread });
    for (const error of [
      new Error("offline"),
      Object.assign(new Error("not found"), {
        status: 404,
        code: "route_not_found",
      }),
    ]) {
      harness.inspection.sdk.stub("threads.get", async () => {
        throw error;
      });
      await expect(harness.behavior.callRpc("pending", null)).rejects.toThrow(
        error.message,
      );
      expect(
        bb.storage
          .database()
          .prepare("SELECT count(*) AS count FROM prompts")
          .get(),
      ).toEqual({ count: 1 });
    }
    harness.inspection.sdk.stub("threads.get", async () => {
      throw Object.assign(new Error("Thread not found"), {
        status: 404,
        code: "thread_not_found",
      });
    });
    expect(await harness.behavior.callRpc("pending", null)).toEqual({
      prompt: null,
      count: 0,
    });
  });
  it("bounds prompt reconciliation and signals when another batch remains", async () => {
    const { harness } = await setup();
    for (let i = 0; i < 21; i++)
      await harness.behavior.emitThreadEvent("thread.archived", {
        thread: { ...thread, id: `thr_${String(i).padStart(2, "0")}` },
      });
    harness.inspection.sdk.stub("threads.get", async () => ({
      ...thread,
      archivedAt: null,
    }));
    const signals = harness.inspection.realtimeSignals.length;
    expect(await harness.behavior.callRpc("pending", null)).toEqual({
      prompt: null,
      count: 1,
    });
    expect(harness.inspection.sdk.callsTo("threads.get")).toHaveLength(20);
    expect(harness.inspection.realtimeSignals).toHaveLength(signals + 1);
    expect(await harness.behavior.callRpc("pending", null)).toEqual({
      prompt: null,
      count: 0,
    });
  });
  it("does not prune a newer archive while an older prompt lookup is in flight", async () => {
    const { bb, harness } = await setup();
    await harness.behavior.emitThreadEvent("thread.archived", { thread });
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    harness.inspection.sdk.stub("threads.get", async () => {
      entered();
      await gate;
      return { ...thread, archivedAt: null };
    });
    const pending = harness.behavior.callRpc("pending", null);
    await reading;
    await harness.behavior.emitThreadEvent("thread.archived", {
      thread: { ...thread, archivedAt: 2000 },
    });
    release();
    expect(await pending).toEqual({ prompt: null, count: 1 });
    expect(
      bb.storage.database().prepare("SELECT archived_at FROM prompts").all(),
    ).toEqual([{ archived_at: 2000 }]);
  });
  describe("retros", () => {
    type Harness = Awaited<ReturnType<typeof setup>>["harness"];
    const fileRetro = (
      harness: Harness,
      params: Record<string, unknown>,
      threadId = thread.id,
    ) =>
      harness.registrations.agentTools
        .find((entry) => entry.name === "file_retro")!
        .execute(params, {
          threadId,
          projectId: thread.projectId,
          signal: new AbortController().signal,
        });
    const draftFor = async (harness: Harness, threadId = thread.id) =>
      (await harness.behavior.callRpc("getDraft", { threadId })) as {
        filedAt: number;
      } | null;

    it("registers the tool for ordinary threads and withholds it from plugin threads", async () => {
      const { harness } = await setup();
      expect(
        harness.registrations.agentTools.map((entry) => entry.name),
      ).toEqual(["file_retro"]);
      const provider = harness.registrations.agentConfigurationProvider!;
      expect(provider(makePluginAgentConfigurationContext()).tools).toEqual([
        "file_retro",
      ]);
      expect(
        provider(
          makePluginAgentConfigurationContext({
            origin: { kind: "fork", pluginId: "side-chat" },
          }),
        ).tools,
      ).toEqual([]);
    });

    it("files a draft for itself and a direct child, latest draft wins", async () => {
      const child = makeThreadResponse({
        id: "thr_child",
        projectId: thread.projectId,
        providerId: "pi",
        title: "Child chat",
        parentThreadId: thread.id,
        archivedAt: null,
      });
      const { harness } = await setup({ [child.id]: child });
      await fileRetro(harness, {
        score: 4,
        useCases: ["design"],
        note: " Self note ",
      });
      await fileRetro(harness, {
        subjectThreadId: child.id,
        score: 3,
        useCases: ["review"],
        note: "Child note",
      });
      expect(
        await harness.behavior.callRpc("getDraft", { threadId: thread.id }),
      ).toMatchObject({
        subjectThreadId: thread.id,
        subjectTitle: thread.title,
        filedByThreadId: thread.id,
        projectId: thread.projectId,
        score: 4,
        useCases: ["design"],
        note: "Self note",
      });
      const listed = (await harness.behavior.callRpc("retroDrafts", {
        offset: 0,
      })) as {
        total: number;
        drafts: Array<Record<string, unknown>>;
      };
      expect(listed.total).toBe(2);
      expect(listed.drafts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            subjectThreadId: child.id,
            subjectTitle: "Child chat",
            filedByThreadId: thread.id,
            score: 3,
            ratingRevision: null,
          }),
        ]),
      );
      await fileRetro(harness, {
        subjectThreadId: child.id,
        score: 5,
        useCases: ["review"],
      });
      expect(await draftFor(harness, child.id)).toMatchObject({ score: 5 });
    });

    it("rejects a subject that is not this chat or its direct child", async () => {
      const sibling = makeThreadResponse({
        id: "thr_sibling",
        projectId: thread.projectId,
        parentThreadId: "thr_elsewhere",
        archivedAt: null,
      });
      const { harness } = await setup({ [sibling.id]: sibling });
      await expect(
        fileRetro(harness, {
          subjectThreadId: sibling.id,
          score: 3,
          useCases: ["other"],
        }),
      ).rejects.toThrow(/direct subthread/);
      harness.inspection.sdk.stub("threads.get", async () => ({
        ...thread,
        visibility: "hidden",
      }));
      await expect(
        fileRetro(harness, { score: 3, useCases: ["other"] }),
      ).rejects.toThrow(/deleted or hidden/);
    });

    it("confirms a draft into a rating with provenance and clears the draft", async () => {
      const { bb, harness } = await setup();
      await fileRetro(harness, {
        score: 3,
        useCases: ["design"],
        note: "Drafted note",
      });
      const draft = (await draftFor(harness))!;
      const rating = await harness.behavior.callRpc("confirmDraft", {
        subjectThreadId: thread.id,
        expectedRevision: null,
        draftFiledAt: draft.filedAt,
        score: 4,
        useCases: ["design", "review"],
        note: "Confirmed with edits",
      });
      expect(rating).toMatchObject({
        threadId: thread.id,
        archivedAt: 1000,
        score: 4,
        useCases: ["design", "review"],
        note: "Confirmed with edits",
        draft: {
          by: "agent",
          draftedByThreadId: thread.id,
          draftedAt: draft.filedAt,
        },
        history: {
          observations: [{ model: "local/model-a", reasoningLevel: "high" }],
        },
      });
      expect(await draftFor(harness)).toBe(null);
      expect(
        (
          (await harness.behavior.callRpc("list", { offset: 0 })) as {
            ratings: Array<Record<string, unknown>>;
          }
        ).ratings[0],
      ).toMatchObject({ draft: { by: "agent" } });
      expect(
        bb.storage
          .database()
          .prepare("SELECT count(*) AS count FROM retro_drafts")
          .get(),
      ).toEqual({ count: 0 });
    });

    it("records a null archive time when confirming on a live chat", async () => {
      const { harness } = await setup();
      harness.inspection.sdk.stub("threads.get", async () => ({
        ...thread,
        archivedAt: null,
      }));
      await fileRetro(harness, { score: 4, useCases: ["coding"] });
      const draft = (await draftFor(harness))!;
      expect(
        await harness.behavior.callRpc("confirmDraft", {
          subjectThreadId: thread.id,
          expectedRevision: null,
          draftFiledAt: draft.filedAt,
          score: 4,
          useCases: ["coding"],
          note: "",
        }),
      ).toMatchObject({ archivedAt: null });
      expect(
        await harness.behavior.callRpc("exportPage", { afterThreadId: "" }),
      ).toMatchObject({
        rating: { archivedAt: null, draft: { by: "agent" } },
      });
    });

    it("claims provenance when an archive save starts from a draft", async () => {
      const { harness } = await setup();
      await fileRetro(harness, { score: 2, useCases: ["other"] });
      const draft = (await draftFor(harness))!;
      await harness.behavior.emitThreadEvent("thread.archived", { thread });
      expect(
        await harness.behavior.callRpc("savePrompt", {
          ...save,
          draftFiledAt: draft.filedAt,
        }),
      ).toMatchObject({
        score: 4,
        draft: { by: "agent", draftedAt: draft.filedAt },
      });
      expect(await draftFor(harness)).toBe(null);
    });

    it("refuses a discarded or stale draft confirmation", async () => {
      const { harness } = await setup();
      await fileRetro(harness, { score: 3, useCases: ["other"] });
      const draft = (await draftFor(harness))!;
      await expect(
        harness.behavior.callRpc("confirmDraft", {
          subjectThreadId: thread.id,
          expectedRevision: null,
          draftFiledAt: draft.filedAt + 1,
          score: 3,
          useCases: ["other"],
          note: "",
        }),
      ).rejects.toThrow(/changed or was dismissed/);
      expect(
        await harness.behavior.callRpc("discardDraft", {
          subjectThreadId: thread.id,
        }),
      ).toEqual({ removed: true });
      expect(await draftFor(harness)).toBe(null);
      await expect(
        harness.behavior.callRpc("confirmDraft", {
          subjectThreadId: thread.id,
          expectedRevision: null,
          draftFiledAt: draft.filedAt,
          score: 3,
          useCases: ["other"],
          note: "",
        }),
      ).rejects.toThrow(/changed or was dismissed/);
    });

    it("clears pending drafts when their thread or rating is deleted", async () => {
      const { harness } = await setup();
      await fileRetro(harness, { score: 3, useCases: ["other"] });
      await harness.behavior.emitThreadEvent("thread.deleted", {
        thread: { ...thread, deletedAt: 2000 },
      });
      expect(await draftFor(harness)).toBe(null);
      await harness.behavior.emitThreadEvent("thread.archived", { thread });
      await harness.behavior.callRpc("savePrompt", save);
      await fileRetro(harness, { score: 3, useCases: ["other"] });
      await harness.behavior.callRpc("deleteRating", {
        threadId: thread.id,
        expectedRevision: 1,
      });
      expect(await draftFor(harness)).toBe(null);
    });

    it("reads legacy ratings as having no draft provenance", async () => {
      const { bb, harness } = await setup();
      await harness.behavior.emitThreadEvent("thread.archived", { thread });
      const saved = (await harness.behavior.callRpc(
        "savePrompt",
        save,
      )) as Record<string, unknown>;
      expect(saved).toMatchObject({ draft: null });
      const legacy = { ...saved };
      delete legacy.draft;
      bb.storage
        .database()
        .prepare("UPDATE ratings SET record = ? WHERE thread_id = ?")
        .run(JSON.stringify(legacy), thread.id);
      expect(
        await harness.behavior.callRpc("getRating", { threadId: thread.id }),
      ).toMatchObject({ draft: null });
    });
  });
  it("scans only public SDK and self-contained package imports", async () => {
    const scan = await experimental_scanPublicSdkOnly(
      fileURLToPath(new URL(".", import.meta.url)),
      {
        allow: [
          /^react$/,
          /^@radix-ui\//,
          /^@testing-library\//,
          /^vitest$/,
          /^class-variance-authority$/,
          /^clsx$/,
          /^tailwind-merge$/,
          /^@\//,
        ],
      },
    );
    expect(scan.violations).toEqual([]);
    expect(scan.privateDependencies).toEqual([]);
  });
});
