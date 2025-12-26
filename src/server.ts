import { routeAgentRequest } from "agents";

import { AIChatAgent } from "agents/ai-chat-agent";
import {
  generateText,
  streamText,
  type StreamTextOnFinishCallback,
  stepCountIs,
  createUIMessageStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  Output,
  type ToolSet,
  type UIMessage
} from "ai";
import { createWorkersAI } from 'workers-ai-provider';
import { env } from "cloudflare:workers";
import { z } from "zod";
const workersai = createWorkersAI({ binding: env.AI });

type Result<T, E> = 
  | { success: true; value: T }
  | { success: false; error: E };

const chatModel = workersai("@cf/meta/llama-2-7b-chat-int8");
const instructModel = workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast" as any);

const introductionSchema = z.object({ // for strict validation
  firstName: z.string(),
  lastName: z.string(),
  age: z.number(),
  interests: z.array(z.string())
});
const partialIntroductionSchema = z.object({ // partial, with descriptions, for partial filling
  firstName: z.string(),
  lastName: z.string(),
  age: z.number(),
  interests: z.array(z.string()).describe("Interests/Hobbies of the user"),
}).partial();
type Introduction = z.infer<typeof introductionSchema>;

/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {

  async extractIntroductionData(message: UIMessage): Promise<Result<Introduction, string[]>> {
    // Extract data
    const result = await generateText({
      system: `Extract information from this message to fill in the following fields.
Only fill fields if the user gave context around the information. "I'm 19" is ok, "It's 19" is not.`,
      messages: await convertToModelMessages(this.messages),
      model: instructModel,
      stopWhen: stepCountIs(10),
      output: Output.object({
        schema: partialIntroductionSchema,
      }),
    });

    const zodResult = introductionSchema.safeParse(result.output);
    if (zodResult.success) {
      return {success: true, value: zodResult.data};
    }
    return {success: false, error: zodResult.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`)};
  }

  /**
   * Handles incoming chat messages and manages the response stream
   */
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    _options?: { abortSignal?: AbortSignal }
  ) {
    const msg = this.messages[this.messages.length - 1];
    const extractResult = await this.extractIntroductionData(msg);
    if (extractResult.success) {
      console.log("OK !");
      return;
    }

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        const generateResult = streamText({
          system: `You are chatting with a new user on a meetup website. You are a mysterious user already part of the platform, and need to ask the user about himself before revealing who you are. You need must gather the following information from the user to complete their introduction, which may be unset or set badly: ${extractResult.error.join(", ")}. Sound friendly and welcoming.`,

          messages: await convertToModelMessages(this.messages),
          model: chatModel,
          stopWhen: stepCountIs(1),
        });

        writer.merge(generateResult.toUIMessageStream());
      }
    });

    return createUIMessageStreamResponse({ stream });
  }
}

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/check-open-ai-key") {
      return Response.json({
        success: true,
      });
    }
    return (
      // Route the request to our agent or return 404 if not found
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
