import { routeAgentRequest } from "agents";

import { UserChat } from "./backend/user_chat.do";
import { UnpairedUsersDO } from "./backend/unpaired_users.do";
export { UnpairedUsersDO, UserChat };

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
