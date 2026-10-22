// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Base} from "./Base.t.sol";
import {StashPool, IOperatorBonds, Verifiers} from "../src/StashPool.sol";
import {StashPoolHarness} from "./Base.t.sol";
import {Hashers} from "../src/interfaces/IPoseidon.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {ScreeningGate} from "../src/ScreeningGate.sol";
import {Auth3009} from "../src/interfaces/IUSDG.sol";
import {Proof} from "../src/interfaces/IVerifiers.sol";

/// Regression tests for the 2026-10-22 audit findings (one per ledger id).
contract AuditFixesTest is Base {
    function _ext(int256 extAmount, uint256 fee) internal returns (StashPool.ExtData memory e) {
        e = StashPool.ExtData(alice, extAmount, makeAddr("relayer"), fee, hex"", hex"");
    }

    function _fundShielded() internal {
        uint256 seq = _deposit(alice, 1_000e6, 1);
        skip(15 minutes);
        pool.admitAfterStandby(seq);
    }

    // tree-capacity-exhaustion: 2^32 leaves, so filling the tree is not a practical attack.
    function test_treeHas32Levels() public view {
        assertEq(pool.LEVELS(), 32);
    }

    // root-history-eviction: a root stays valid however many leaves follow it.
    function test_oldRootsStayValid() public {
        _fundShielded();
        uint256 old = pool.lastRoot();
        for (uint256 i = 0; i < 60; i++) {
            pool.transact(_proof(), pool.lastRoot(), [100 + 2 * i, 101 + 2 * i], [i + 1, i + 2], _ext(0, 0));
        }
        assertTrue(pool.isKnownRoot(old));
        assertFalse(pool.isKnownRoot(0));
        pool.transact(_proof(), old, [uint256(9_001), 9_002], [uint256(7), 8], _ext(0, 0));
    }

    // fee-bypass-relayer-fee: the fee leg is capped near a relayer's cost.
    function test_transactFeeLegIsCapped() public {
        _fundShielded();
        uint256 cap = pool.MAX_RELAYER_FEE();
        uint256 root = pool.lastRoot();
        StashPool.ExtData memory over = _ext(0, cap + 1);
        vm.expectRevert(StashPool.BadExtData.selector);
        pool.transact(_proof(), root, [uint256(1), 2], [uint256(3), 4], over);
        pool.transact(_proof(), root, [uint256(1), 2], [uint256(3), 4], _ext(0, cap));
    }

    // dust deposits would each add a leaf.
    function test_minDeposit() public {
        vm.prank(alice);
        vm.expectRevert(StashPool.BadAmount.selector);
        pool.deposit(1e6 - 1, 1, hex"", hex"");
        _deposit(alice, 1e6, 1);
    }

    // donation-cap-dos: a direct transfer to the pool cannot trip the canary cap.
    function test_donationDoesNotTripTheCap() public {
        vm.prank(owner);
        pool.setCaps(1_000e6, 2_000e6);
        usdg.mint(address(pool), 10_000e6); // donation
        _deposit(alice, 1_000e6, 1);
        _deposit(alice, 1_000e6, 2);
        vm.prank(alice);
        vm.expectRevert(StashPool.OverCap.selector);
        pool.deposit(1e6, 3, hex"", hex"");
    }

    // ppoi-skips-standby-for-fresh-origin: the proof path is for deposits only.
    function test_admitWithProofsRefusesSendBacks() public {
        (address tin, uint256 key) = makeAddrAndKey("tin");
        pool.fundTinForTest(tin, 25e6);
        usdg.mint(tin, 25e6);
        bytes32 nonce = pool.sendBackNonce(1, 0, hex"", hex"");
        Auth3009 memory a = _auth3009(key, tin, 20e6, nonce);
        uint256 seq = pool.returnToStash(a, 0, 1, hex"", hex"");
        Proof[] memory proofs = new Proof[](2);
        vm.expectRevert(StashPool.BadEntryState.selector);
        pool.admitWithProofs(seq, proofs);
        // A deposit still can.
        uint256 dep = _deposit(alice, 5e6, 2);
        pool.admitWithProofs(dep, proofs);
    }

    // privileged setters are range-checked.
    function test_settersAreBounded() public {
        vm.startPrank(owner);
        vm.expectRevert(StashPool.ZeroAddress.selector);
        pool.setFeeRouter(makeAddr("eoa"));
        vm.expectRevert(StashPool.ZeroAddress.selector);
        pool.setBonds(IOperatorBonds(makeAddr("eoa2")));
        vm.expectRevert(StashPool.ZeroAddress.selector);
        pool.setOperator(address(0), true);
        vm.expectRevert(StashPool.ZeroAddress.selector);
        pool.setGuardian(address(0));
        vm.expectRevert(StashPool.OutOfBounds.selector);
        pool.setCaps(2_000e6, 1_000e6); // per-deposit above the total
        vm.stopPrank();
    }

    // P13: the last index is never used, so nextIndex cannot overflow; a full tree reverts.
    function test_fullTreeReverts() public {
        bytes32 slot = bytes32(uint256(66)); // nextIndex (forge inspect StashPool storageLayout)
        uint256 word = uint256(vm.load(address(pool), slot));
        vm.store(address(pool), slot, bytes32((word & ~uint256(type(uint32).max)) | type(uint32).max));
        assertEq(pool.nextIndex(), type(uint32).max);
        uint256 seq = _deposit(alice, 5e6, 1);
        skip(15 minutes);
        vm.expectRevert(bytes4(keccak256("TreeFull()")));
        pool.admitAfterStandby(seq);
    }

    // P16: proofs are bound to one pool on one chain.
    function test_proofDomainDiffersPerPool() public {
        StashPoolHarness other = new StashPoolHarness(
            pool.usdg(), gate, Verifiers(pool.joinsplitVerifier(), pool.tinRequestVerifier(), pool.ppoiVerifier()),
            Hashers(pool.poseidonT3(), pool.poseidonT4()), owner, guardian
        );
        assertTrue(other.POOL_ID() != pool.POOL_ID());
        StashPool.ExtData memory e = _ext(-1e6, 0);
        assertTrue(other.extDataHash(e) != pool.extDataHash(e));
        vm.chainId(999);
        StashPoolHarness sameAddrOtherChain = StashPoolHarness(address(pool));
        assertTrue(uint256(keccak256(abi.encode(block.chainid, address(sameAddrOtherChain)))) % FIELD != pool.POOL_ID());
    }

    // D3: a mainnet deploy refuses a deployer-held owner.
    function test_deployRefusesDeployerOwnerOnMainnet() public {
        Deploy d = new Deploy();
        vm.chainId(4663);
        vm.expectRevert(bytes("mainnet: set SAFE (and optionally OWNER)"));
        d.run();
    }

    // a provider root outside the SNARK field would disable the proof path.
    function test_providerRootMustBeAFieldElement() public {
        vm.prank(provider1);
        vm.expectRevert(ScreeningGate.BadRoot.selector);
        gate.updateRoot(FIELD);
        vm.prank(provider1);
        vm.expectRevert(ScreeningGate.BadRoot.selector);
        gate.updateRoot(0);
    }
}

import {TokenBase} from "./Token.t.sol";
import {Bonds} from "../src/Bonds.sol";

contract StakingIdleTest is TokenBase {
    // A stream that sat idle past its period must not pay its backlog out in one block.
    function test_longIdleStreamIsNotClaimableAtOnce() public {
        pool.sweepFees();
        router.distribute();
        uint256 reward = usdg.balanceOf(address(staking));
        assertGt(reward, 0);
        skip(30 days); // nobody stakes for longer than the 7-day period
        address a = makeAddr("lateStaker");
        vm.prank(safe);
        foilToken.transfer(a, 100e18);
        vm.startPrank(a);
        foilToken.approve(address(staking), 100e18);
        staking.stake(100e18);
        staking.claim();
        assertEq(usdg.balanceOf(a), 0, "nothing streams in the block of the first stake");
        skip(7 days);
        staking.claim();
        vm.stopPrank();
        assertApproxEqAbs(usdg.balanceOf(a), reward, 2, "the whole reward streams over the 7 days after");
    }
}

/// Returns ~110 KB on every call: copying it would cost the caller quadratic memory gas.
contract ReturnBomb {
    fallback() external payable {
        assembly {
            return(0, 110000)
        }
    }
}

contract AuditFixesRoundTest is TokenBase {
    function _bond(address who) internal {
        vm.prank(safe);
        foilToken.transfer(who, 30_000e18);
        vm.startPrank(who);
        foilToken.approve(address(bonds), type(uint256).max);
        bonds.bond(Bonds.Role.Operator);
        vm.stopPrank();
    }

    // returndata-bomb-round-dos: a tin returning a huge payload cannot price the round out.
    function test_returndataBombTinCannotBlockTheRound() public {
        _bond(op);
        address bomb = address(new ReturnBomb());
        for (uint256 i = 0; i < 30; i++) {
            pool.requestTin(_proof(), _args(10e6, bomb, bytes32(i), bytes32(i)));
        }
        vm.warp(block.timestamp - (block.timestamp % 600) + 600);
        pool.closeRound();
        address[] memory tins = new address[](30);
        bytes32[] memory salts = new bytes32[](30);
        for (uint256 i = 0; i < 30; i++) (tins[i], salts[i]) = (bomb, bytes32(i));
        uint256 v = pool.ethPerTin() * 30;
        vm.prank(op);
        uint256 g = gasleft();
        pool.executeRound{value: v}(1, tins, salts);
        assertLt(g - gasleft(), 6_000_000, "linear in the number of tins");
        assertEq(usdg.balanceOf(bomb), 300e6);
    }

    // single-attestor-bond-freeze: one attestor alone cannot block a withdrawal.
    function test_oneAttestorCannotFreezeABond() public {
        _bond(op);
        vm.prank(attestors[0]);
        uint256 s = bonds.proposeBadReveal(op, bytes32(uint256(1)), 1);
        vm.prank(attestors[0]);
        vm.expectRevert(Bonds.BadEvidence.selector); // the same evidence backs one proposal
        bonds.proposeBadReveal(op, bytes32(uint256(1)), 1);
        vm.prank(op);
        bonds.requestUnbond(Bonds.Role.Operator);
        skip(14 days);
        vm.prank(owner);
        pool.setOperator(op, false);
        vm.prank(op);
        bonds.withdraw(Bonds.Role.Operator); // a 1-vote proposal does not block it
        assertTrue(s == 0);
    }

    function test_twoVotesBlockWithdrawal() public {
        _bond(op);
        vm.prank(attestors[0]);
        uint256 s = bonds.proposeBadReveal(op, bytes32(uint256(1)), 1);
        vm.prank(attestors[1]);
        bonds.vote(s);
        vm.prank(op);
        bonds.requestUnbond(Bonds.Role.Operator);
        skip(14 days);
        vm.prank(owner);
        pool.setOperator(op, false);
        vm.prank(op);
        vm.expectRevert(Bonds.SlashPending.selector);
        bonds.withdraw(Bonds.Role.Operator);
        bonds.expire(s); // missed its vote window: frees the bond
        vm.prank(op);
        bonds.withdraw(Bonds.Role.Operator);
    }

    // reward-period-extension: a later notify joins the stream instead of stretching it.
    function test_notifyDoesNotStretchTheRunningStream() public {
        address a = makeAddr("earlyStaker");
        vm.prank(safe);
        foilToken.transfer(a, 100e18);
        vm.startPrank(a);
        foilToken.approve(address(staking), 100e18);
        staking.stake(100e18);
        vm.stopPrank();
        pool.sweepFees();
        router.distribute();
        uint256 first = usdg.balanceOf(address(staking));
        uint256 end = staking.periodFinish();
        skip(1 days);
        usdg.mint(address(router), 10e6); // a $10 top-up
        router.distribute();
        assertEq(staking.periodFinish(), end, "same end");
        vm.warp(end);
        vm.prank(a);
        staking.claim();
        assertApproxEqAbs(usdg.balanceOf(a), first + 10e6 * 500 / 10_000, 3, "everything streamed by the original end");
    }
}
