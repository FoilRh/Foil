/**
 * Execute one call from the mainnet Safe (2-of-3): owners 1 and 2 sign, the deployer pays gas.
 *   NETWORK=mainnet bun scripts/safe-exec.ts <to> <calldata>           plan only
 *   NETWORK=mainnet bun scripts/safe-exec.ts <to> <calldata> --send    sign and execute
 * Owner keys: owner 1 from deploy/<network>-owners.env; the others you bring for the run with
 * SAFE_KEY_FILES=<path to owner2.txt>[,...] (owners 2 and 3 are kept off this machine). The
 * Safe address and the deployer from deploy/<network>.env. Never prints secrets.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { concatHex, createPublicClient, createWalletClient, http, isAddress, isHex, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const NETWORK = process.env.NETWORK === "mainnet" ? "mainnet" : "testnet";
const [to, data] = process.argv.slice(2) as [Address, Hex];
if (!isAddress(to ?? "") || !isHex(data ?? "")) throw new Error("usage: safe-exec.ts <to> <calldata> [--send]");
const readEnv = (f: string) => Object.fromEntries(readFileSync(join(import.meta.dir, "..", "deploy", f), "utf8").split(/\r?\n/).flatMap((l) => {
  const m = /^([A-Z0-9_]+)=(.+)$/.exec(l.trim());
  return m ? [[m[1]!, m[2]!]] : [];
})) as Record<string, string>;
const env = readEnv(`${NETWORK}.env`);
const owners = readEnv(`${NETWORK}-owners.env`);
const safe = env.SAFE as Address;
const rpc = env.RPC_URL!;
const chain = { id: NETWORK === "mainnet" ? 4663 : 46630, name: `rhc-${NETWORK}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } } as const;
const pub = createPublicClient({ chain, transport: http(rpc, { retryCount: 5 }) });
const abi = parseAbi([
  "function nonce() view returns (uint256)",
  "function getThreshold() view returns (uint256)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)",
]);

const nonce = await pub.readContract({ address: safe, abi, functionName: "nonce" });
const threshold = await pub.readContract({ address: safe, abi, functionName: "getThreshold" });
const zero = "0x0000000000000000000000000000000000000000" as Address;
const tx = { to, value: 0n, data, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: zero, refundReceiver: zero, nonce };
console.log(`${NETWORK} Safe ${safe} (threshold ${threshold}, nonce ${nonce}): call ${to} with ${data.slice(0, 10)}…`);
if (!process.argv.includes("--send")) {
  console.log("plan only: rerun with --send");
  process.exit(0);
}

// Owner keys on this machine (normally only owner 1), plus owner keys you bring for this one run:
// SAFE_KEY_FILES=E:/owner2.txt (comma-separated; files as exported, or a bare 0x key per line).
const fromFiles = (process.env.SAFE_KEY_FILES ?? "").split(",").filter(Boolean)
  .flatMap((f) => readFileSync(f.trim(), "utf8").match(/0x[0-9a-fA-F]{64}/g) ?? []);
const keys = [owners.SAFE_OWNER1_PRIVATE_KEY, owners.SAFE_OWNER2_PRIVATE_KEY, owners.SAFE_OWNER3_PRIVATE_KEY, ...fromFiles].filter(Boolean);
const signers = [...new Map(keys.map((k) => privateKeyToAccount(k as Hex)).map((a) => [a.address, a])).values()].slice(0, Number(threshold));
if (signers.length < Number(threshold)) {
  throw new Error(`need ${threshold} owner keys, have ${signers.length}: pass the others with SAFE_KEY_FILES=<path to owner2.txt>`);
}
const types = { SafeTx: [
  { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" },
  { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" }, { name: "gasPrice", type: "uint256" },
  { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" }, { name: "nonce", type: "uint256" },
] } as const;
const sigs = await Promise.all(signers.map(async (s) => ({
  owner: s.address,
  sig: await s.signTypedData({ domain: { chainId: chain.id, verifyingContract: safe }, types, primaryType: "SafeTx", message: tx }),
})));
// Safe wants signatures sorted by owner address, ascending.
const signatures = concatHex(sigs.sort((a, b) => (BigInt(a.owner) < BigInt(b.owner) ? -1 : 1)).map((s) => s.sig));

const deployer = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY as Hex);
const wallet = createWalletClient({ chain, transport: http(rpc, { retryCount: 5 }), account: deployer });
const hash = await wallet.writeContract({
  address: safe, abi, functionName: "execTransaction",
  args: [tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, signatures],
});
const rcpt = await pub.waitForTransactionReceipt({ hash });
console.log(`executed: ${rcpt.status} ${hash}`);
process.exit(rcpt.status === "success" ? 0 : 1);
