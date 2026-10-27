import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./src/contract";
import { createTodoSnapshots } from "./src/snapshot";

export default function plugin(bb: BbPluginApi) {
  const snapshots = createTodoSnapshots(bb);
  bb.settings.define({
    expandOnEnter: {
      type: "boolean",
      label: "Expand list when opening a thread",
      description:
        "When on, the to-do card starts expanded. When off, only the N/M complete header shows until you open it.",
      default: true,
    },
  });

  bb.rpc.register(rpcContract, {
    getTodos({ threadId }) {
      return snapshots.get(threadId);
    },
  });

  const publish = (threadId: string) => {
    bb.realtime.publish("todos", { threadId });
  };
  bb.events.on("thread.active", ({ thread }) => {
    publish(thread.id);
  });
  bb.events.on("thread.idle", ({ thread }) => {
    publish(thread.id);
  });
  bb.log.info("loaded");
}
