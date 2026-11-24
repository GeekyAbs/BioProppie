import { onRequestGet as healthGet } from "./functions/api/health.js";
import { onRequestPost as modePost } from "./functions/api/mode.js";
import { onRequestPost as queryPost } from "./functions/api/query.js";
import { onRequestGet as stateGet } from "./functions/api/state.js";

const routes = {
  "/api/health": { GET: healthGet },
  "/health": { GET: healthGet },
  "/api/state": { GET: stateGet },
  "/api/mode": { POST: modePost },
  "/api/query": { POST: queryPost },
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const route = routes[url.pathname];

    if (route) {
      const handler = route[request.method];
      if (!handler) {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: { Allow: Object.keys(route).join(", ") },
        });
      }
      return await handler({ request, env, ctx, params: {} });
    }

    return await env.ASSETS.fetch(request);
  },
};
