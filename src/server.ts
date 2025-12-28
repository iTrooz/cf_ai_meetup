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
  type UIMessage,
  generateId
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
export class Chat extends AIChatAgent<Env, State> {

  initialState = {
    state: "introduction" as const,
  }
  unpairedUsers: DurableObjectStub<UnpairedUsersDO>;

  constructor(ctx: AgentContext, env: Env) {
    super(ctx, env);
    this.unpairedUsers = env.UnpairedUsersDO.getByName("default");
  }

  async getIntroductionData(): Promise<IntroductionData | undefined> {
    return await this.ctx.storage.get<IntroductionData>("introductionData");
  }

  async onStateUpdate(state: State) {
    console.log("state updated", state);
    
    if (state.state == "waiting_for_partner") {
      this.unpairedUsers.add(this.name);
    } else {
      this.unpairedUsers.remove(this.name);
    }

    if (state.state == "chatting" && state.partner) {
      const partnerAgent = await getAgentByName(this.env.Chat, state.partner);
      const partnerIntroData = await partnerAgent.getIntroductionData();
      this.sendChatMessage(`You are now connected with ${partnerIntroData?.firstName}. Say hi!`, "assistant");
    }
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

  async sendChatMessage(s: string, role: "user" | "assistant") {
    const msg = {
        sentFromServer: true,
        id: generateId(),
        role,
        parts: [
          {
            type: "text",
            text: s,
          }
        ],
        metadata: {
          createdAt: new Date()
        }
      };
    await this.saveMessages([...this.messages, msg as any]);
  }

  /**
   * Handles incoming chat messages and manages the response stream
   */
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    _options?: { abortSignal?: AbortSignal }
  ) {
    // Ensure we do not reply to ourselves
    let lastMsg = this.messages[this.messages.length - 1];
    if ((lastMsg as any).sentFromServer) return;

    switch (this.state.state) {
      case "introduction":
        return this.onIntroductionChatMessage();
      case "waiting_for_partner":
        // should not happen
        this.sendChatMessage("Please wait while we find you a partner to chat with...", "assistant");
      case "chatting":
        const partnerDo = await getAgentByName(this.env.Chat, this.state.partner!);
        partnerDo.sendChatMessage(lastMsg.parts.map(p => p.type == "text" ? p.text : "").join(""), "user");
        return;
    }
  }

  async introductionComplete(intro: IntroductionData) {
    this.sendChatMessage("Good ! Now that I have all your information, you can proceed to access the platform. Welcome aboard!", "assistant");
    this.setState({ state: "waiting_for_partner" });
    this.ctx.storage.put("introductionData", intro);
    // TODO save intro data
    this.searchPartner();
  }

  async searchPartner() {
    const userIDs = await this.unpairedUsers.list();
    // Make at most 50 tries to find a partner
    for (let i = 0; i < Math.min(userIDs.length, 50); i++) {
      const userID = userIDs.splice(Math.floor(Math.random() * userIDs.length), 1)[0];
      console.log(`checking potential partner for ${this.name}: ${userID}`);
      if (userID != this.name) { // not yourself
        console.log(`found partner for ${this.name}: ${userID}`);
        const otherAgent = await getAgentByName(this.env.Chat, userID);
        otherAgent.setState({ state: "chatting", partner: this.name });
        this.setState({ state: "chatting", partner: userID });
        return;
      }
    }
    console.log(`no partner found for ${this.name}, staying unpaired`);
  }

  async onIntroductionChatMessage() {
    const msg = this.messages[this.messages.length - 1];
    const extractResult = await this.extractIntroductionData(msg);
    if (extractResult.success) {
      this.introductionComplete(extractResult.value);
      return
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
