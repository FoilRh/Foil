/**
 * Note ciphertexts: X25519 ECDH to the recipient's ek, HKDF-SHA256, XChaCha20-Poly1305.
 * Blob = epk(32) ‖ nonce(24) ‖ ciphertext(amount 16B ‖ rho 32B ‖ tag 16B) = 120 bytes,
 * a fixed size so ciphertexts reveal nothing. Recipients trial-decrypt every leaf and
 * then re-check the commitment, so a forged ciphertext cannot fake a balance.
 */
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, type Hex } from "viem";

const info = new TextEncoder().encode("foil-v1/note");
const be = (n: bigint, len: number) => hexToBytes(`0x${n.toString(16).padStart(len * 2, "0")}`);

export const NOTE_BLOB_BYTES = 120;

/** Encrypts (amount, rho) to the recipient's ek as a fixed 120-byte blob; fresh ephemeral key per call. */
export function encryptNote(ekPub: Uint8Array, amount: bigint, rho: bigint): Hex {
  const eph = x25519.utils.randomSecretKey();
  const epk = x25519.getPublicKey(eph);
  const key = hkdf(sha256, x25519.getSharedSecret(eph, ekPub), epk, info, 32);
  const nonce = crypto.getRandomValues(new Uint8Array(24));
  const pt = new Uint8Array(48);
  pt.set(be(amount, 16), 0);
  pt.set(be(rho, 32), 16);
  const ct = xchacha20poly1305(key, nonce).encrypt(pt);
  const out = new Uint8Array(NOTE_BLOB_BYTES);
  out.set(epk, 0);
  out.set(nonce, 32);
  out.set(ct, 56);
  return bytesToHex(out);
}

/** Trial-decrypts a blob; null if it is not for this key. Callers must still re-check the commitment. */
export function decryptNote(ekPriv: Uint8Array, blob: Hex): { amount: bigint; rho: bigint } | null {
  const b = hexToBytes(blob);
  if (b.length !== NOTE_BLOB_BYTES) return null;
  try {
    const epk = b.slice(0, 32);
    const key = hkdf(sha256, x25519.getSharedSecret(ekPriv, epk), epk, info, 32);
    const pt = xchacha20poly1305(key, b.slice(32, 56)).decrypt(b.slice(56));
    return { amount: BigInt(bytesToHex(pt.slice(0, 16))), rho: BigInt(bytesToHex(pt.slice(16))) };
  } catch {
    return null;
  }
}

/** Deposits and send-backs carry (ciphertext, epk) separately on-chain; split the blob. */
export const splitBlob = (blob: Hex) => ({ epk: `0x${blob.slice(2, 66)}` as Hex, ciphertext: `0x${blob.slice(66)}` as Hex });
/** Inverse of splitBlob: epk ‖ ciphertext. */
export const joinBlob = (ciphertext: Hex, epk: Hex) => `0x${epk.slice(2)}${ciphertext.slice(2)}` as Hex;
