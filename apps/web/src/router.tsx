import { createRouter } from "@tanstack/react-router";
import { QueryClient, QueryCache, MutationCache } from "@tanstack/react-query";
import { routeTree } from "./routeTree.gen";
import { initErrorReporting, captureError } from "./lib/telemetry";
export function getRouter() {
  initErrorReporting();
  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => captureError(error, "query"),
    }),
    mutationCache: new MutationCache({
      onError: (error) => captureError(error, "mutation"),
    }),
    defaultOptions: {
      queries: { staleTime: 60_000, retry: false, refetchOnWindowFocus: false },
    },
  });
  return createRouter({
    routeTree,
    defaultOnCatch: (error) => captureError(error, "react-boundary"),
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
  });
}
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
