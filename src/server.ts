import { getAgentByName, routeAgentRequest, type AgentContext } from "agents";

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
import { UnpairedUsersDO } from "./backend/unpaired_users.do";
export { UnpairedUsersDO };

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
type IntroductionData = z.infer<typeof introductionSchema>;

/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env, CommonState> {

  initialState = {
    state: "introduction" as const,
  }
  unpairedUsers: DurableObjectStub<UnpairedUsersDO>;

  constructor(ctx: AgentContext, env: Env) {
    super(ctx, env);
    this.unpairedUsers = env.UnpairedUsersDO.getByName("default");
  }

  async onStateUpdate(state: CommonState) {
    console.log("state updated", state);
    
    if (state.state == "waiting_for_partner") {
      this.unpairedUsers.add(this.name);
    } else {
      this.unpairedUsers.remove(this.name);
    }
  }

  // Manually send a message as the agent
  // HACK
  async responseFromString(s: string): Promise<Response> {
    let id = Math.random().toString(36).slice(2, 7);
    let TEXT = `\
data: {"type":"text-start","id":"${id}"}
data: {"type":"text-delta","id":"${id}","delta":" ${s}"}
data: {"type":"text-end","id":"${id}"}
data: [DONE]
`;
    const resp = new Response(TEXT, {
      headers: {
        "Content-Type": "text/event-stream",
      }
    });
    return resp;
  }

  async extractIntroductionData(message: UIMessage): Promise<Result<IntroductionData, string[]>> {
    // Extract data
    const result = await generateText({
      system: `Extract information from this conversation to fill in the following fields.
Only fill fields if the user gave context around the information. "I'm 19" is ok, "It's 19" is not. Fill fields even if the information comes from older messages`,
      messages: await convertToModelMessages(this.messages),
      model: instructModel,
      stopWhen: stepCountIs(10),
      output: Output.object({
        schema: partialIntroductionSchema,
      }),
    });

    const zodResult = introductionSchema.safeParse(result.output);
    console.log("extracted info so far:", result.output);
    if (zodResult.success) {
      return {success: true, value: zodResult.data};
    }
    const msg = zodResult.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`);
    console.log("missing info so far:", msg);
    return {success: false, error: msg};
  }

  /**
   * Handles incoming chat messages and manages the response stream
   */
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    _options?: { abortSignal?: AbortSignal }
  ) {
    switch (this.state.state) {
      case "introduction":
        return this.onIntroductionChatMessage();
      case "waiting_for_partner":
        // should not happen
        return this.responseFromString("Please wait while we find you a partner to chat with...");
    }
  }

  async introductionComplete(intro: IntroductionData) {
    this.setState({ state: "waiting_for_partner" });

    const userIDs = await this.unpairedUsers.list();
    // Make at most 50 tries to find a partner
    for (let i = 0; i < Math.min(userIDs.length, 50); i++) {
      const userID = userIDs[Math.floor(Math.random() * userIDs.length)];
      if (userID != this.name) { // not yourself
        // Found a partner
        const otherAgent = await getAgentByName(this.env.Chat, userID);
        otherAgent.setState({ state: "chatting", partner: this.name });
        this.setState({ state: "chatting", partner: userID });
      }
    }
  }

  async onIntroductionChatMessage() {
    const msg = this.messages[this.messages.length - 1];
    const extractResult = await this.extractIntroductionData(msg);
    if (extractResult.success) {
      this.introductionComplete(extractResult.value);
      return this.responseFromString("Good ! Now that I have all your information, you can proceed to access the platform. Welcome aboard!");
    }

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        const generateResult = streamText({
          system: `You are a chatbot interacting with a new user on a meetup website. Your only goal is to gather the following information from the user to complete their introduction and access the platform: ${extractResult.error.join(", ")}. Sound friendly and welcoming, but do not forget your only goal: get the user to provide the missing information. He will then be forwarded to an actual user.`,

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
