// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {StashPool, Verifiers} from "../../src/StashPool.sol";
import {ScreeningGate} from "../../src/ScreeningGate.sol";
import {IUSDG, Auth3009} from "../../src/interfaces/IUSDG.sol";
import {IJoinsplitVerifier, IPpoiVerifier, ITinRequestVerifier} from "../../src/interfaces/IVerifiers.sol";
import {StashPoolHarness} from "../Base.t.sol";
import {MockVerifier} from "../mocks/MockVerifier.sol";
import {DeployHashers} from "../utils/DeployHashers.sol";

/// Build "U" items, against the real USDG on a fork of Robinhood Chain (4663):
///   - receiveWithAuthorization works for the pool, with Foil's note-bound nonce
///   - transferWithAuthorization works for a tin paying someone (the CC pay step)
/// Run: RHC_RPC_URL=https://rpc.mainnet.chain.robinhood.com FOUNDRY_PROFILE=fork forge test
contract RhcUsdgForkTest is Test {
    IUSDG constant USDG = IUSDG(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168);
    bytes32 constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 constant TRANSFER_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    StashPoolHarness pool;
    address tin;
    uint256 tinKey;

    function setUp() public {
        vm.createSelectFork(vm.envString("RHC_RPC_URL"));
        assertEq(block.chainid, 4663);
        address m = address(new MockVerifier());
        pool = new StashPoolHarness(
            USDG, new ScreeningGate(address(this)), Verifiers(IJoinsplitVerifier(m), ITinRequestVerifier(m), IPpoiVerifier(m)),
            DeployHashers.deploy(), address(this), address(this)
        );
        (tin, tinKey) = makeAddrAndKey("fork-tin");
        deal(address(USDG), tin, 25e6); // forge-std finds USDG's balance slot behind its proxy
        assertEq(USDG.balanceOf(tin), 25e6);
        pool.fundTinForTest(tin, 25e6);
    }

    function _sign(bytes32 typehash, address to, uint256 value, bytes32 nonce) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash = keccak256(abi.encode(typehash, tin, to, value, 0, block.timestamp + 1 hours, nonce));
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Global Dollar"), keccak256("1"), block.chainid, address(USDG)
            )
        );
        return vm.sign(tinKey, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
    }

    function test_realUsdg_returnToStash() public {
        bytes32 nonce = pool.sendBackNonce(42, 0, hex"aa", hex"bb");
        (uint8 v, bytes32 r, bytes32 s) = _sign(RECEIVE_TYPEHASH, address(pool), 25e6, nonce);
        Auth3009 memory a = Auth3009(tin, 25e6, 0, block.timestamp + 1 hours, v, r, s);
        uint256 seq = pool.returnToStash(a, 0, 42, hex"aa", hex"bb");
        assertEq(USDG.balanceOf(address(pool)), 25e6);
        assertEq(USDG.balanceOf(tin), 0);
        (,,,, uint256 gross,,) = pool.entries(seq);
        assertEq(gross, 25e6);
        // Real USDG silently ignores a reused authorization; the pool must refuse it
        // (otherwise a replay would burn one of the tin's send-back slots).
        vm.expectRevert(StashPool.BadAmount.selector);
        pool.returnToStash(a, 0, 42, hex"aa", hex"bb");
        assertEq(pool.tinSendBacks(tin), 1);
    }

    function test_realUsdg_tinPaysByTransferWithAuthorization() public {
        address payee = makeAddr("cc-payTo");
        bytes32 nonce = keccak256("cc-memo");
        (uint8 v, bytes32 r, bytes32 s) = _sign(TRANSFER_TYPEHASH, payee, 10e6, nonce);
        // A relayer submits it: the tin needs no ETH.
        vm.prank(makeAddr("relayer"));
        (bool ok,) = address(USDG).call(
            abi.encodeWithSignature(
                "transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)",
                tin, payee, 10e6, 0, block.timestamp + 1 hours, nonce, v, r, s
            )
        );
        assertTrue(ok, "transferWithAuthorization");
        assertEq(USDG.balanceOf(payee), 10e6);
    }
}
