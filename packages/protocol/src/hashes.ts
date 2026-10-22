/** keccak-based hashes that mirror StashPool exactly (reduced mod the BN254 field). */
import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const mod = (h: Hex) => BigInt(h) % FIELD;

/** StashPool.tinCommitOf: keccak(abi.encode(tin, salt, size, roundId)) mod p. */
export const tinCommitOf = (tin: Address, salt: Hex, size: bigint, roundId: bigint) =>
  mod(keccak256(encodeAbiParameters(
    [{ type: "address" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }], [tin, salt, size, roundId],
  )));

/** StashPool cancelHash: keccak(abi.encode(secret)) mod p; the secret stays on the device until cancel. */
export const cancelHashOf = (secret: Hex) => mod(keccak256(encodeAbiParameters([{ type: "bytes32" }], [secret])));

/** tin_request extDataHash: keccak(abi.encode(poolId, relayer, encryptedChange)) mod p. */
export const tinRequestDataHash = (poolId: bigint, relayer: Address, encryptedChange: Hex) =>
  mod(keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "bytes" }], [poolId, relayer, encryptedChange])));

/** Packed requestOfCommit value → (roundId, reqIdx), or null when unused. */
export function decodeRequestRef(ref: bigint): { roundId: bigint; reqIdx: number } | null {
  if (ref === 0n) return null;
  return { roundId: ref >> 32n, reqIdx: Number(ref & 0xffffffffn) - 1 };
}
