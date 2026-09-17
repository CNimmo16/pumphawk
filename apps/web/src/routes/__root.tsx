import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import styles from "../styles.css?url";
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    head: () => ({
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: "Pump Hawk — A little foresight. A fuller tank." },
        {
          name: "description",
          content:
            "Follow UK petrol price trends and find a smarter time to fill up.",
        },
      ],
      links: [{ rel: "stylesheet", href: styles }],
    }),
    component: Root,
  },
);
function Root() {
  const { queryClient } = Route.useRouteContext();
  return (
    <html lang="en-GB">
      <head>
        <HeadContent />
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          <Outlet />
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
