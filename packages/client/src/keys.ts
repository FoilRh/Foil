/**
 * Key hierarchy (Build §2). Everything derives from one BIP-39 seed, on the device.
 *   sk_auth  Baby Jubjub EdDSA key: signs spends, never leaves the device
 *   nk       nullifying key          ek  X25519 note-encryption key (incoming view)
 *   tin_i    secp256k1 EOA at m/44'/60'/4040'/0'/i' (hardened: a gifted tin key
 *            reveals nothing about its siblings)
 * Per-tin salts, cancel secrets and refund rhos are derived too, so a restore from the
 * seed alone can reveal, cancel or self-execute outstanding requests.
 */
import { generateMnemonic as gen, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { HDKey } from "@scure/bip32";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { FIELD, tinPath } from "@foil/protocol";
import { mpkOf, type Crypto } from "./crypto";
import { ownerFrom, type Owner } from "./spend";

const te = new TextEncoder();
const derive = (seed: Uint8Array, label: string, len = 32) => hkdf(sha256, seed, te.encode("foil-v1"), te.encode(label), len);
const toField = (b: Uint8Array) => BigInt(bytesToHex(b)) % FIELD;

/** New 12-word English BIP-39 recovery phrase (128-bit entropy). */
export const generateMnemonic = () => gen(wordlist, 128);
/** BIP-39 checksum check, ignoring case and surrounding whitespace. */
export const isValidMnemonic = (m: string) => validateMnemonic(m.trim().toLowerCase(), wordlist);

export interface Keys {
  owner: Owner;
  ekPriv: Uint8Array;
  ekPub: Uint8Array;
  /** Share this to receive notes: mpk ‖ ekPub. */
  stashAddress: Hex;
  tin(i: number): { address: Hex; privateKey: Hex };
  tinSalt(i: number): Hex;
  cancelSecret(i: number): Hex;
  refundRho(i: number): bigint;
  /** Seed-derived locator and key for the encrypted backup blob (Build §9). */
  backupLocator: Hex;
  backupKey: Uint8Array;
  /** handle_s = HKDF(seed, "handle/" ‖ season): an ed25519 key per season (Build §2, §7). */
  handleKey(season: string): Uint8Array;
}

/** Derives the whole key hierarchy from the recovery phrase, on-device; throws on an invalid phrase. */
export function keysFromMnemonic(c: Crypto, mnemonic: string): Keys {
  if (!isValidMnemonic(mnemonic)) throw new Error("invalid recovery phrase");
  const seed = mnemonicToSeedSync(mnemonic.trim().toLowerCase());
  const owner = ownerFrom(c, derive(seed, "sk_auth"), toField(derive(seed, "nk")));
  const ekPriv = derive(seed, "ek");
  const ekPub = x25519.getPublicKey(ekPriv);
  const master = HDKey.fromMasterSeed(seed);
  const mpkBytes = owner.mpk.toString(16).padStart(64, "0");
  return {
    owner,
    ekPriv,
    ekPub,
    stashAddress: `0x${mpkBytes}${bytesToHex(ekPub).slice(2)}`,
    tin(i) {
      const k = master.derive(tinPath(i));
      if (!k.privateKey) throw new Error("tin derivation failed");
      const privateKey = bytesToHex(k.privateKey);
      return { address: privateKeyToAccount(privateKey).address, privateKey };
    },
    tinSalt: (i) => bytesToHex(derive(seed, `tin-salt/${i}`)),
    cancelSecret: (i) => bytesToHex(derive(seed, `cancel/${i}`)),
    refundRho: (i) => toField(derive(seed, `refund-rho/${i}`)),
    backupLocator: bytesToHex(derive(seed, "backup-locator")),
    backupKey: derive(seed, "backup-key"),
    handleKey: (season) => derive(seed, `handle/${season}`),
  };
}

/** Parse a stash address shared by someone else. */
export function parseStashAddress(a: string): { mpk: bigint; ekPub: Uint8Array } {
  if (!/^0x[0-9a-fA-F]{128}$/.test(a)) throw new Error("not a Foil stash address");
  const mpk = BigInt(`0x${a.slice(2, 66)}`);
  if (mpk >= FIELD) throw new Error("not a Foil stash address");
  return { mpk, ekPub: Uint8Array.from(a.slice(66).match(/../g)!, (x) => parseInt(x, 16)) };
}

export { mpkOf };
