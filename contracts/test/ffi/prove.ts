// FFI helper for RealProof.t.sol: prints ABI-encoded data as hex on stdout.
//   owner                                         → (uint256 depositNpk)
//   withdraw <poolId> <token> <net> <recipient> <relayer> → proof + transact args
import { encodeAbiParameters, type Address } from "viem";
import { join } from "node:path";
import {
  MerkleTree, buildJoinsplit, buildTinRequest, commitmentOf, dummyNote, loadCrypto, ownNpk, ownerFrom, prove,
} from "@foil/client";

const c = await loadCrypto();
const owner = ownerFrom(c, new Uint8Array(32).fill(7), 424242n);
const DEPOSIT_RHO = 7n;
const art = (f: string) => join(import.meta.dir, "..", "..", "..", "circuits", "build", "artifacts", f);

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "owner") {
  process.stdout.write(encodeAbiParameters([{ type: "uint256" }], [ownNpk(c, owner, DEPOSIT_RHO)]));
} else if (cmd === "withdraw") {
  const [poolId, token, net, recipient, relayer] = args as [string, string, string, Address, Address];
  const tree = new MerkleTree(c);
  const npk = ownNpk(c, owner, DEPOSIT_RHO);
  tree.insert(commitmentOf(c, BigInt(token), BigInt(net), npk));
  const withdraw = 10_000_000n;
  const fee = 250_000n;
  const { input, call } = buildJoinsplit({
    c, owner, tree, token: BigInt(token), poolId: BigInt(poolId),
    inputs: [{ amount: BigInt(net), rho: DEPOSIT_RHO, index: 0 }, dummyNote()],
    outputs: [{ amount: BigInt(net) - withdraw - fee, npk: ownNpk(c, owner, 8n) }, { amount: 0n, npk: 99n }],
    ext: { recipient, extAmount: -withdraw, relayer, fee, encryptedOutput1: "0x01", encryptedOutput2: "0x02" },
  });
  const { proof } = await prove(input, art("joinsplit.wasm"), art("joinsplit.zkey"));
  process.stdout.write(
    encodeAbiParameters(
      [
        { type: "uint256[2]" }, { type: "uint256[2][2]" }, { type: "uint256[2]" },
        { type: "uint256" }, { type: "uint256[2]" }, { type: "uint256[2]" },
        { type: "address" }, { type: "int256" }, { type: "address" }, { type: "uint256" }, { type: "uint256" },
      ],
      [proof.a, proof.b, proof.c, call.root, call.nullifiers, call.outs, recipient, -withdraw, relayer, fee, input.extDataHash],
    ),
  );
} else if (cmd === "request") {
  // request <poolId> <token> <net> <reserved> <roundId> <tin> <relayer>
  const [poolId, token, net, reserved, roundId, tin, relayer] = args as [string, string, string, string, string, Address, Address];
  const tree = new MerkleTree(c);
  tree.insert(commitmentOf(c, BigInt(token), BigInt(net), ownNpk(c, owner, DEPOSIT_RHO)));
  const salt = `0x${"ab".repeat(32)}` as const;
  const cancelSecret = `0x${"cd".repeat(32)}` as const;
  const { input, call } = buildTinRequest({
    c, owner, tree, token: BigInt(token), poolId: BigInt(poolId),
    inputs: [{ amount: BigInt(net), rho: DEPOSIT_RHO, index: 0 }, dummyNote()],
    size: 25_000_000n, reserved: BigInt(reserved), fee: 250_000n, roundId: BigInt(roundId),
    tin, salt, cancelSecret, relayer, encryptedChange: "0xcc", changeRho: 9n, refundRho: 10n,
  });
  const { proof } = await prove(input, art("tin_request.wasm"), art("tin_request.zkey"));
  process.stdout.write(
    encodeAbiParameters(
      [
        { type: "uint256[2]" }, { type: "uint256[2][2]" }, { type: "uint256[2]" },
        { type: "uint256" }, { type: "uint256[2]" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
        { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }, { type: "bytes32" },
      ],
      [
        proof.a, proof.b, proof.c, call.root, call.nullifiers, call.changeCommitment, call.size, call.fee,
        call.roundId, call.tinCommit, call.refundCommit, call.cancelHash, salt, cancelSecret,
      ],
    ),
  );
} else {
  throw new Error(`unknown command ${cmd}`);
}
process.exit(0);
