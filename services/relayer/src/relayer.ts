/**
 * Relayer (Build §1): submits Stash transactions so users never need ETH or reveal a
 * wallet. Fees are inside the proof (transact / requestTin) and paid to this relayer.
 * Every call is simulated first; anything that would revert is refused.
 */
import type { Address, Hex, LocalAccount, PublicClient, WalletClient } from "viem";
import { BaseError, ContractFunctionRevertedError } from "viem";
import { FEES, reviveArgs, stashPoolAbi } from "@foil/protocol";

/** Pool functions the relayer will submit. Owner/operator functions are excluded. */
export const RELAYABLE = new Set([
  "transact", "requestTin", "returnToStash", "exitPending", "admitAfterStandby", "admitWithSignatures",
  "admitWithProofs", "cancelRequest", "selfExecute", "closeRound",
]);

/** Reasons the relayer chose to give; safe to show a client (apps/api passes `expose` errors through). */
export class RelayError extends Error {
  readonly expose = true;
}

export interface RelayerDeps {
  pool: Address;
  account: LocalAccount;
  publicClient: PublicClient;
  walletClient: WalletClient;
  feeFloor?: bigint;
}

/**
 * Builds the relayer. `relay(fn, jsonArgs)` revives JSON args against the pool ABI, checks the
 * in-proof fee (paid to this relayer, ≥ `feeFloor`, USDG base units), simulates, then submits
 * serially so nonces never race. Failures surface as RelayError.
 */
export function createRelayer(d: RelayerDeps) {
  const floor = d.feeFloor ?? FEES.relayerFloor;
  let queue: Promise<unknown> = Promise.resolve(); // one tx at a time: no nonce races

  function checkFee(fn: string, args: unknown[]) {
    const fee = fn === "transact" ? (args[4] as { fee: bigint; relayer: Address }) : fn === "requestTin" ? (args[1] as { fee: bigint; relayer: Address }) : null;
    if (!fee) return;
    if (fee.relayer.toLowerCase() !== d.account.address.toLowerCase()) throw new RelayError("fee must be paid to this relayer");
    if (fee.fee < floor) throw new RelayError(`fee below the ${floor} floor`);
  }

  return {
    address: d.account.address,
    feeFloor: floor,
    async relay(fn: string, jsonArgs: unknown[]): Promise<{ txHash: Hex }> {
      if (!RELAYABLE.has(fn)) throw new RelayError(`${fn} is not relayable`);
      let args: unknown[];
      try {
        args = reviveArgs(stashPoolAbi, fn, jsonArgs);
      } catch (e) {
        throw new RelayError((e as Error).message);
      }
      checkFee(fn, args);
      const run = async () => {
        try {
          const { request } = await d.publicClient.simulateContract({
            address: d.pool, abi: stashPoolAbi, functionName: fn, args, account: d.account,
          } as never);
          const txHash = await d.walletClient.writeContract(request as never);
          const r = await d.publicClient.waitForTransactionReceipt({ hash: txHash });
          if (r.status !== "success") throw new RelayError("transaction reverted");
          return { txHash };
        } catch (e) {
          if (e instanceof RelayError) throw e;
          const revert = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
          const name = revert instanceof ContractFunctionRevertedError ? revert.data?.errorName : undefined;
          throw new RelayError(name ? `reverted: ${name}` : "simulation failed");
        }
      };
      const p = queue.then(run, run);
      queue = p.catch(() => {});
      return p;
    },
  };
}
