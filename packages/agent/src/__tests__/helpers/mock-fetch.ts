import { vi } from "vitest";

interface MockRoute {
  url: RegExp | string;
  body: unknown;
  status?: number;
  headers?: Record<string, string>;
}

/**
 * Sets up a global fetch mock that matches request URLs against a list of
 * routes and returns canned responses. Unmatched URLs get a 404.
 *
 * Returns the spy so callers can assert on call counts, etc.
 */
export function mockFetchResponses(routes: MockRoute[]) {
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      for (const route of routes) {
        const match =
          typeof route.url === "string"
            ? url.includes(route.url)
            : route.url.test(url);

        if (match) {
          return new Response(JSON.stringify(route.body), {
            status: route.status ?? 200,
            headers: { "Content-Type": "application/json", ...route.headers },
          });
        }
      }

      return new Response("Not Found", { status: 404 });
    },
  );

  return spy;
}
