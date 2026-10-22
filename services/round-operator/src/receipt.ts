/**
 * Signed reveal receipts (Build §3.2 "Omission"): the operator signs every reveal it
 * accepts. A receipt for a request the operator later leaves out of an executed round
 * is the slashing evidence (Bonds, M11).
 */
import { verifyTypedData, type Address, type LocalAccount } from "viem";

export const receiptTypes = {
  RevealReceipt: [
    { name: "roundId", type: "uint256" },
    { name: "tinCommit", type: "uint256" },
    { name: "receivedAt", type: "uint64" },
  ],
} as const;

/** EIP-712 domain for reveal receipts, bound to one chain and pool. */
export const receiptDomain = (chainId: number, pool: Address) =>
  ({ name: "FoilRoundOperator", version: "1", chainId, verifyingContract: pool }) as const;

export interface Receipt { roundId: bigint; tinCommit: bigint; receivedAt: bigint; signature: `0x${string}` }

/** EIP-712-signs a RevealReceipt with the operator's key. */
export async function signReceipt(account: LocalAccount, chainId: number, pool: Address, r: Omit<Receipt, "signature">): Promise<Receipt> {
  const signature = await account.signTypedData({
    domain: receiptDomain(chainId, pool),
    types: receiptTypes,
    primaryType: "RevealReceipt",
    message: r,
  });
  return { ...r, signature };
}

/** Resolves true if `r.signature` is `operator`'s EIP-712 signature over the receipt. */
export function verifyReceipt(operator: Address, chainId: number, pool: Address, r: Receipt) {
  return verifyTypedData({
    address: operator,
    domain: receiptDomain(chainId, pool),
    types: receiptTypes,
    primaryType: "RevealReceipt",
    message: { roundId: r.roundId, tinCommit: r.tinCommit, receivedAt: r.receivedAt },
    signature: r.signature,
  });
}
