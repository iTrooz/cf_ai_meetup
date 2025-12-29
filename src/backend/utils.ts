import { createWorkersAI } from "workers-ai-provider";
import { env } from "cloudflare:workers";
import { z } from "zod";

import { setupLogger } from "./logger";
export const globalLogger = setupLogger();

export const workersai = createWorkersAI({ binding: env.AI });

export type Result<T, E> = 
  | { success: true; value: T }
  | { success: false; error: E };

export const chatModel = workersai("@cf/meta/llama-2-7b-chat-int8");
export const instructModel = workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast" as any);

export const introductionSchema = z.object({ // for strict validation
  firstName: z.string(),
  lastName: z.string(),
  age: z.number(),
  interests: z.array(z.string())
});
export const partialIntroductionSchema = z.object({ // partial, with descriptions, for partial filling
  firstName: z.string(),
  lastName: z.string(),
  age: z.number(),
  interests: z.array(z.string()).describe("Interests/Hobbies of the user"),
}).partial();
export type IntroductionData = z.infer<typeof introductionSchema>;
