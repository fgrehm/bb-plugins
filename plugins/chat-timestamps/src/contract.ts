import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const MAX_THREAD_IDS = 8;

export const messageTimeSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  direction: z.enum(["sent", "received"]),
});

export const cursorSchema = z
  .object({
    anchorSeq: z.string(),
    anchorId: z.string(),
  })
  .strict();

export type MessageTime = z.infer<typeof messageTimeSchema>;
export type Cursor = z.infer<typeof cursorSchema>;

export const rpcContract = defineRpcContract({
  messageTimes: {
    input: z
      .object({
        threadIds: z.array(z.string().min(1)).min(1).max(MAX_THREAD_IDS),
      })
      .strict(),
    output: z
      .object({
        messages: z.array(messageTimeSchema),
        cursors: z.array(
          z
            .object({
              threadId: z.string(),
              cursor: cursorSchema.nullable(),
            })
            .strict(),
        ),
      })
      .strict(),
  },
  olderMessageTimes: {
    input: z
      .object({
        threadId: z.string().min(1),
        cursor: cursorSchema,
      })
      .strict(),
    output: z
      .object({
        messages: z.array(messageTimeSchema),
        cursor: cursorSchema.nullable(),
      })
      .strict(),
  },
});
