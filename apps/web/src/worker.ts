import handler from "@tanstack/react-start/server-entry";
export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname.startsWith("/api/"))
      return env.API.fetch(request);
    return handler.fetch(request);
  },
} satisfies ExportedHandler<Env>;
