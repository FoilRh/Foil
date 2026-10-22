/** viem client whose JSON-RPC goes through the API's allowlisted rpc proxy (over OHTTP). */
import { createPublicClient, custom } from "viem";
import type { Api } from "./api";

/** viem PublicClient that sends JSON-RPC via `api.rpc` (OHTTP), never to an RPC node directly. */
export function createChainClient(api: Api) {
  return createPublicClient({
    // No block-number cache: a sync right after a relayed tx must see that tx's block.
    cacheTime: 0,
    transport: custom({ request: ({ method, params }) => api.rpc.mutate({ method, params: (params as unknown[]) ?? [] }) }),
  });
}
