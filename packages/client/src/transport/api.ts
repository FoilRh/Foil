/** Typed tRPC client for apps/api, carried over OHTTP. */
import { createTRPCClient, httpLink } from "@trpc/client";
import type { AppRouter } from "@foil/api";
import { createOhttpFetch, type OhttpFetchOptions } from "./ohttp-fetch";

/** tRPC client for apps/api whose every request goes through OHTTP. */
export function createApi(o: OhttpFetchOptions) {
  const fetch = createOhttpFetch(o);
  // The origin is a placeholder: only the path reaches the gateway, inside the ciphertext.
  return createTRPCClient<AppRouter>({ links: [httpLink({ url: "https://foil.internal/trpc", fetch })] });
}

export type Api = ReturnType<typeof createApi>;
