// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {StashPool, Verifiers, IOperatorBonds} from "../../src/StashPool.sol";
import {MockBonds} from "../mocks/MockBonds.sol";
import {TinRequestVerifier} from "../../src/verifiers/TinRequestVerifier.sol";
import {ScreeningGate} from "../../src/ScreeningGate.sol";
import {JoinsplitVerifier} from "../../src/verifiers/JoinsplitVerifier.sol";
import {PpoiVerifier} from "../../src/verifiers/PpoiVerifier.sol";
import {IUSDG} from "../../src/interfaces/IUSDG.sol";
import {IJoinsplitVerifier, IPpoiVerifier, ITinRequestVerifier, Proof} from "../../src/interfaces/IVerifiers.sol";
import {MockUSDG} from "../mocks/MockUSDG.sol";
import {DeployHashers} from "../utils/DeployHashers.sol";

/// End-to-end with the generated verifier and a real Groth16 proof from packages/client.
/// Catches public-signal order, extDataHash encoding and G2 coordinate mistakes.
contract RealProofTest is Test {
    MockUSDG usdg;
    StashPool pool;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address relayer = makeAddr("relayer");

    function setUp() public {
        usdg = new MockUSDG();
        ScreeningGate gate = new ScreeningGate(address(this));
        pool = new StashPool(
            IUSDG(address(usdg)),
            gate,
            Verifiers(
                IJoinsplitVerifier(address(new JoinsplitVerifier())),
                ITinRequestVerifier(address(new TinRequestVerifier())),
                IPpoiVerifier(address(new PpoiVerifier()))
            ),
            DeployHashers.deploy(),
            address(this),
            address(this)
        );
        usdg.mint(alice, 100e6);
        vm.prank(alice);
        usdg.approve(address(pool), type(uint256).max);
    }

    function _ffi(string[] memory args) internal returns (bytes memory) {
        string[] memory cmd = new string[](args.length + 2);
        cmd[0] = "bun";
        cmd[1] = "test/ffi/prove.ts";
        for (uint256 i = 0; i < args.length; i++) cmd[i + 2] = args[i];
        return vm.ffi(cmd);
    }

    function test_realWithdraw() public {
        string[] memory a = new string[](1);
        a[0] = "owner";
        uint256 npk = abi.decode(_ffi(a), (uint256));

        vm.prank(alice);
        uint256 seq = pool.deposit(30e6, npk, "", "");
        skip(1 hours);
        pool.admitAfterStandby(seq);
        uint256 net = 30e6 - 45_000;

        string[] memory w = new string[](6);
        w[0] = "withdraw";
        w[1] = vm.toString(pool.POOL_ID());
        w[2] = vm.toString(address(usdg));
        w[3] = vm.toString(net);
        w[4] = vm.toString(bob);
        w[5] = vm.toString(relayer);
        bytes memory out = _ffi(w);

        (Proof memory p, uint256 root, uint256[2] memory nulls, uint256[2] memory outs, StashPool.ExtData memory ext, uint256 jsHash) =
            _decode(out);
        assertEq(root, pool.lastRoot(), "client tree matches the contract tree");
        assertEq(jsHash, pool.extDataHash(ext), "client extDataHash matches the contract");

        // A relayer swapping the recipient breaks extDataHash → proof fails.
        // (A fresh struct: assigning `forged = ext` would alias the same memory.)
        StashPool.ExtData memory forged =
            StashPool.ExtData(relayer, ext.extAmount, ext.relayer, ext.fee, ext.encryptedOutput1, ext.encryptedOutput2);
        vm.expectRevert(StashPool.InvalidProof.selector);
        pool.transact(p, root, nulls, outs, forged);

        pool.transact(p, root, nulls, outs, ext);
        assertEq(usdg.balanceOf(bob), 10e6 - 25_000);
        assertEq(usdg.balanceOf(relayer), 250_000);

        vm.expectRevert(StashPool.NullifierSpent.selector);
        pool.transact(p, root, nulls, outs, ext);
    }

    function test_realTinRequestThroughExecution() public {
        string[] memory a = new string[](1);
        a[0] = "owner";
        uint256 npk = abi.decode(_ffi(a), (uint256));
        vm.prank(alice);
        uint256 seq = pool.deposit(30e6, npk, "", "");
        skip(1 hours);
        pool.admitAfterStandby(seq);

        address tin = makeAddr("tin");
        string[] memory r = new string[](8);
        r[0] = "request";
        r[1] = vm.toString(pool.POOL_ID());
        r[2] = vm.toString(address(usdg));
        r[3] = vm.toString(uint256(30e6 - 45_000));
        r[4] = vm.toString(pool.reservedFor(25e6));
        r[5] = vm.toString(pool.currentRound());
        r[6] = vm.toString(tin);
        r[7] = vm.toString(relayer);
        StashPool.TinRequestArgs memory args;
        Proof memory p;
        bytes32 salt;
        bytes32 secret;
        (p, args, salt, secret) = _decodeRequest(_ffi(r));
        args.relayer = relayer;
        args.encryptedChange = hex"cc";

        uint256 reqIdx = pool.requestTin(p, args);
        assertEq(usdg.balanceOf(relayer), 250_000);

        skip(31 minutes);
        pool.closeRound();
        address op = makeAddr("operator");
        pool.setOperator(op, true);
        MockBonds mb = new MockBonds();
        mb.set(op, true);
        pool.setBonds(IOperatorBonds(address(mb)));
        vm.deal(op, 1 ether);
        address[] memory tins = new address[](1);
        bytes32[] memory salts = new bytes32[](1);
        (tins[0], salts[0]) = (tin, salt);
        uint256 v = pool.ethPerTin();
        vm.prank(op);
        pool.executeRound{value: v}(args.roundId, tins, salts);
        assertEq(usdg.balanceOf(tin), 25e6);
        assertEq(tin.balance, v);
        assertEq(uint8(pool.getRequest(args.roundId, reqIdx).state), uint8(StashPool.RequestState.Executed));
        assertTrue(secret != 0);
    }

    function _decodeRequest(bytes memory out)
        internal
        pure
        returns (Proof memory p, StashPool.TinRequestArgs memory a, bytes32 salt, bytes32 secret)
    {
        (p.a, p.b, p.c, a.root, a.nullifiers, a.changeCommitment, a.size, a.fee) =
            abi.decode(out, (uint256[2], uint256[2][2], uint256[2], uint256, uint256[2], uint256, uint256, uint256));
        // Second half: skip the first 14 words (a=2, b=4, c=2, root, nullifiers=2, change, size, fee).
        bytes memory rest = new bytes(out.length - 14 * 32);
        for (uint256 i = 0; i < rest.length; i++) rest[i] = out[i + 14 * 32];
        (a.roundId, a.tinCommit, a.refundCommit, a.cancelHash, salt, secret) =
            abi.decode(rest, (uint256, uint256, uint256, uint256, bytes32, bytes32));
    }

    function _decode(bytes memory out)
        internal
        pure
        returns (
            Proof memory p,
            uint256 root,
            uint256[2] memory nulls,
            uint256[2] memory outs,
            StashPool.ExtData memory ext,
            uint256 jsExtDataHash
        )
    {
        address recipient;
        int256 extAmount;
        address rel;
        uint256 fee;
        (p.a, p.b, p.c, root, nulls, outs, recipient, extAmount, rel, fee, jsExtDataHash) = abi.decode(
            out, (uint256[2], uint256[2][2], uint256[2], uint256, uint256[2], uint256[2], address, int256, address, uint256, uint256)
        );
        ext = StashPool.ExtData(recipient, extAmount, rel, fee, hex"01", hex"02");
    }
}
