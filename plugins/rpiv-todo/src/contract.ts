import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const todoStatusSchema = z.enum(["pending", "in_progress", "completed"]);

export const rpcContract = defineRpcContract({
  getTodos: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.object({
      items: z.array(
        z.object({
          id: z.string(),
          text: z.string(),
          activeForm: z.string().optional(),
          status: todoStatusSchema,
        }),
      ),
    }),
  },
});
