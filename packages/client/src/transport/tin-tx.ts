/**
 * Browser mode (Build §5A): a tin sends its own transaction (paying gas with its round
 * ETH). Nonce, fees and gas come through the OHTTP rpc proxy; the signed transaction goes
 * to the API's broadcast, which re-runs the guard before relaying it.
 */
import type { Hex, PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Api } from "./api";

/** Signs an EIP-1559 tx from the tin (gas +20%), broadcasts it via the API and waits for the receipt. */
export async function sendFromTin(api: Api, chain: PublicClient, tinKey: Hex, call: { to: Hex; data: Hex }) {
  const account = privateKeyToAccount(tinKey);
  const [nonce, chainId, block, tip, gas] = await Promise.all([
    chain.getTransactionCount({ address: account.address, blockTag: "pending" }),
    chain.getChainId(),
    chain.getBlock(),
    chain.request({ method: "eth_maxPriorityFeePerGas" }).then((x) => BigInt(x as string)).catch(() => 1_000_000n),
    chain.estimateGas({ account: account.address, to: call.to, data: call.data }),
  ]);
  const base = block.baseFeePerGas ?? 0n;
  const raw = await account.signTransaction({
    type: "eip1559", chainId, nonce, to: call.to, data: call.data, value: 0n,
    gas: (gas * 12n) / 10n, maxPriorityFeePerGas: tip, maxFeePerGas: base * 2n + tip,
  });
  const { hash, summary } = await api.broadcast.mutate({ raw });
  await chain.waitForTransactionReceipt({ hash: hash as Hex });
  return { hash: hash as Hex, summary };
}
