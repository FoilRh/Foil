// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {RoundsBase} from "./Rounds.t.sol";
import {StashPool, IOperatorBonds} from "../src/StashPool.sol";
import {FOIL} from "../src/FOIL.sol";
import {FeeRouter, IRewardNotifier} from "../src/FeeRouter.sol";
import {FoilStaking} from "../src/FoilStaking.sol";
import {Bonds} from "../src/Bonds.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Shared deploy of FOIL, FeeRouter, FoilStaking and Bonds over the rounds fixture.
abstract contract TokenBase is RoundsBase {
    FOIL foilToken;
    FeeRouter router;
    FoilStaking staking;
    Bonds bonds;
    address safe = makeAddr("safe");
    address work = makeAddr("work");
    address treasury = makeAddr("treasury");
    address burnSink = makeAddr("burn");
    address[] attestors;
    uint256[] attestorKeys;
    address op;
    uint256 opKey;

    function setUp() public override {
        super.setUp();
        foilToken = new FOIL(safe, 1_000_000_000e18);
        // The router address is needed by staking and vice versa: predict it.
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        staking = new FoilStaking(IERC20(address(foilToken)), IERC20(address(usdg)), predicted, owner);
        router = new FeeRouter(IERC20(address(usdg)), owner, work, treasury, IRewardNotifier(address(staking)), burnSink);
        assertEq(address(router), predicted);
        vm.prank(owner);
        pool.setFeeRouter(address(router));

        bonds = new Bonds(IERC20(address(foilToken)), pool, treasury, owner);
        vm.prank(owner);
        pool.setBonds(IOperatorBonds(address(bonds)));
        for (uint256 i = 0; i < 5; i++) {
            (address a, uint256 k) = makeAddrAndKey(string(abi.encode("attestor", i)));
            attestors.push(a);
            attestorKeys.push(k);
        }
        vm.prank(owner);
        bonds.setAttestors(attestors);
        (op, opKey) = makeAddrAndKey("bonded-operator");
        vm.prank(safe);
        foilToken.transfer(op, 100_000e18);
        vm.prank(owner);
        pool.setOperator(op, true);
        vm.deal(op, 10 ether);
    }

    function _bondOperator() internal {
        vm.startPrank(op);
        foilToken.approve(address(bonds), type(uint256).max);
        bonds.bond(Bonds.Role.Operator);
        vm.stopPrank();
        assertTrue(bonds.isBonded(op, Bonds.Role.Operator));
    }
}

contract TokenTest is TokenBase {
    // ---------------------------------------------------------------- token + fees

    function test_fixedSupplyToSafe() public view {
        assertEq(foilToken.totalSupply(), 1_000_000_000e18);
        assertEq(foilToken.balanceOf(safe), 1_000_000_000e18 - 100_000e18);
    }

    function test_sweepAndDistribute_80_10_5_5() public {
        uint256 fees = pool.feesAccrued(); // the setUp deposit's 0.15%
        assertGt(fees, 0);
        pool.sweepFees();
        assertEq(pool.feesAccrued(), 0);
        assertEq(usdg.balanceOf(address(router)), fees);
        assertEq(usdg.balanceOf(address(pool)), pool.totalIn() - pool.totalOut(), "conservation after sweep");

        router.distribute();
        assertEq(usdg.balanceOf(work), fees * 8_000 / 10_000);
        assertEq(usdg.balanceOf(treasury), fees * 1_000 / 10_000);
        assertEq(usdg.balanceOf(address(staking)), fees * 500 / 10_000);
        assertEq(
            usdg.balanceOf(burnSink),
            fees - fees * 8_000 / 10_000 - fees * 1_000 / 10_000 - fees * 500 / 10_000,
            "burn takes the remainder"
        );
        assertEq(usdg.balanceOf(address(router)), 0);
    }

    function test_onlyRouterNotifiesAndSweepNeedsRouter() public {
        vm.expectRevert(FoilStaking.NotNotifier.selector);
        staking.notifyRewardAmount(1);
    }

    function test_stakersEarnProRataOverSevenDays() public {
        address a = makeAddr("stakerA");
        address b = makeAddr("stakerB");
        vm.startPrank(safe);
        foilToken.transfer(a, 300e18);
        foilToken.transfer(b, 100e18);
        vm.stopPrank();
        vm.startPrank(a);
        foilToken.approve(address(staking), 300e18);
        staking.stake(300e18);
        vm.stopPrank();
        vm.startPrank(b);
        foilToken.approve(address(staking), 100e18);
        staking.stake(100e18);
        vm.stopPrank();

        pool.sweepFees();
        router.distribute();
        uint256 reward = usdg.balanceOf(address(staking));
        skip(7 days);
        vm.prank(a);
        staking.claim();
        vm.prank(b);
        staking.claim();
        // 3:1 split, within rounding dust of the whole reward.
        assertApproxEqAbs(usdg.balanceOf(a), reward * 3 / 4, 2);
        assertApproxEqAbs(usdg.balanceOf(b), reward / 4, 2);
        vm.startPrank(a);
        staking.requestExit(staking.shares(a));
        vm.expectRevert(FoilStaking.Cooldown.selector);
        staking.withdraw();
        skip(7 days);
        staking.withdraw();
        vm.stopPrank();
        assertEq(foilToken.balanceOf(a), 300e18);
    }

    function test_firstLossCoverIsProRataAndCapped() public {
        address a = makeAddr("stakerA");
        address b = makeAddr("stakerB");
        vm.startPrank(safe);
        foilToken.transfer(a, 600e18);
        foilToken.transfer(b, 400e18);
        vm.stopPrank();
        vm.startPrank(a);
        foilToken.approve(address(staking), 600e18);
        staking.stake(600e18);
        vm.stopPrank();
        vm.startPrank(b);
        foilToken.approve(address(staking), 400e18);
        staking.stake(400e18);
        // B tries to leave; the cooldown keeps B's stake at risk.
        staking.requestExit(staking.shares(b));
        vm.stopPrank();

        vm.expectRevert(); // only the owner (timelock)
        staking.cover(op, 100e18, "float");
        vm.prank(owner);
        vm.expectRevert(FoilStaking.TooMuch.selector); // > 30% of the stake
        staking.cover(op, 301e18, "float");

        vm.prank(owner);
        staking.cover(op, 100e18, "round 42 gas spike");
        assertEq(foilToken.balanceOf(op), 100_000e18 + 100e18);
        assertEq(staking.staked(a), 540e18); // 10% loss each
        assertEq(staking.staked(b), 360e18);

        skip(7 days);
        vm.prank(b);
        staking.withdraw();
        assertEq(foilToken.balanceOf(b), 360e18);

        // New stake enters at the post-loss rate: no dilution of the remaining staker.
        address c = makeAddr("stakerC");
        vm.prank(safe);
        foilToken.transfer(c, 90e18);
        vm.startPrank(c);
        foilToken.approve(address(staking), 90e18);
        staking.stake(90e18);
        vm.stopPrank();
        assertEq(staking.staked(c), 90e18);
        assertEq(staking.staked(a), 540e18);
    }

    // ---------------------------------------------------------------- bonds

    function test_unbondWaits14Days() public {
        _bondOperator();
        vm.startPrank(op);
        bonds.requestUnbond(Bonds.Role.Operator);
        vm.expectRevert(Bonds.TooEarly.selector);
        bonds.withdraw(Bonds.Role.Operator);
        skip(14 days);
        vm.expectRevert(Bonds.StillOperator.selector); // must leave the pool role first
        bonds.withdraw(Bonds.Role.Operator);
        vm.stopPrank();
        vm.prank(owner);
        pool.setOperator(op, false);
        vm.prank(op);
        bonds.withdraw(Bonds.Role.Operator);
        assertEq(foilToken.balanceOf(op), 100_000e18);
    }

    function test_livenessSlash_threeVotes_then48h() public {
        _bondOperator();
        (uint256 id,) = _fullRound(8);
        vm.prank(attestors[0]);
        vm.expectRevert(Bonds.BadEvidence.selector); // not late yet
        bonds.proposeLiveness(op, id, 10_000e18);

        skip(61 minutes);
        vm.prank(attestors[0]);
        uint256 s = bonds.proposeLiveness(op, id, 10_000e18);
        vm.prank(attestors[1]);
        bonds.vote(s);
        vm.prank(attestors[1]);
        vm.expectRevert(Bonds.AlreadyVoted.selector);
        bonds.vote(s);
        vm.expectRevert(Bonds.NotApproved.selector);
        bonds.execute(s);
        vm.prank(attestors[2]);
        bonds.vote(s);
        vm.expectRevert(Bonds.TooEarly.selector);
        bonds.execute(s);

        // An approved, unexecuted slash blocks withdrawal.
        vm.prank(op);
        bonds.requestUnbond(Bonds.Role.Operator);
        skip(14 days);
        vm.prank(op);
        vm.expectRevert(Bonds.SlashPending.selector);
        bonds.withdraw(Bonds.Role.Operator);
        bonds.execute(s);
        assertEq(foilToken.balanceOf(treasury), 10_000e18);
        (uint256 left,,) = bonds.bonds(op, Bonds.Role.Operator);
        assertEq(left, 20_000e18);
    }

    function test_omissionSlashProvedByTheOperatorsOwnReceipt() public {
        _bondOperator();
        (uint256 id, Req[] memory rs) = _fullRound(8);
        uint256 tinCommit = pool.tinCommitOf(rs[0].tin, rs[0].salt, 25e6, id);
        uint64 receivedAt = uint64(vm.getBlockTimestamp());
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(opKey, bonds.receiptDigest(id, tinCommit, receivedAt));
        bytes memory receipt = abi.encodePacked(r, s, v);

        // Operator executes the round but leaves rs[0] out.
        Req[] memory some = new Req[](7);
        for (uint256 i = 0; i < 7; i++) some[i] = rs[i + 1];
        (address[] memory tins, bytes32[] memory salts) = _sorted(some);
        uint256 val = pool.ethPerTin() * 7;
        vm.prank(op);
        pool.executeRound{value: val}(id, tins, salts);

        vm.prank(attestors[0]);
        vm.expectRevert(Bonds.BadEvidence.selector); // the operator still has 60 min to finish
        bonds.proposeOmission(op, id, tinCommit, receivedAt, receipt, 30_000e18);
        skip(61 minutes);
        vm.prank(attestors[0]);
        uint256 sid = bonds.proposeOmission(op, id, tinCommit, receivedAt, receipt, 30_000e18);
        vm.prank(attestors[3]);
        bonds.vote(sid);
        vm.prank(attestors[4]);
        bonds.vote(sid);
        skip(48 hours);
        bonds.execute(sid);
        assertEq(foilToken.balanceOf(treasury), 30_000e18);
    }

    function test_omissionNeedsRealEvidence() public {
        _bondOperator();
        (uint256 id, Req[] memory rs) = _fullRound(8);
        uint256 tinCommit = pool.tinCommitOf(rs[0].tin, rs[0].salt, 25e6, id);
        uint64 at = uint64(vm.getBlockTimestamp());
        (, uint256 strangerKey) = makeAddrAndKey("stranger");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(strangerKey, bonds.receiptDigest(id, tinCommit, at));
        vm.prank(attestors[0]);
        vm.expectRevert(Bonds.BadEvidence.selector); // not the operator's signature
        bonds.proposeOmission(op, id, tinCommit, at, abi.encodePacked(r, s, v), 1);

        // A genuine receipt, but the request was executed: no omission.
        (v, r, s) = vm.sign(opKey, bonds.receiptDigest(id, tinCommit, at));
        (address[] memory tins, bytes32[] memory salts) = _sorted(rs);
        uint256 val = pool.ethPerTin() * 8;
        vm.prank(op);
        pool.executeRound{value: val}(id, tins, salts);
        skip(61 minutes);
        vm.prank(attestors[0]);
        vm.expectRevert(Bonds.BadEvidence.selector);
        bonds.proposeOmission(op, id, tinCommit, at, abi.encodePacked(r, s, v), 1);
    }

    function test_omissionIsBoundToTheRoundsExecutor() public {
        _bondOperator();
        (address op2, uint256 op2Key) = makeAddrAndKey("second-operator");
        vm.prank(safe);
        foilToken.transfer(op2, 30_000e18);
        vm.startPrank(op2);
        foilToken.approve(address(bonds), type(uint256).max);
        bonds.bond(Bonds.Role.Operator);
        vm.stopPrank();
        vm.prank(owner);
        pool.setOperator(op2, true);
        vm.deal(op2, 1 ether);

        (uint256 id, Req[] memory rs) = _fullRound(8);
        uint256 tinCommit = pool.tinCommitOf(rs[0].tin, rs[0].salt, 25e6, id);
        uint64 at = uint64(vm.getBlockTimestamp());
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(op2Key, bonds.receiptDigest(id, tinCommit, at));
        // op (not op2) executes first and leaves rs[0] out; op2 signed the receipt.
        Req[] memory some = new Req[](7);
        for (uint256 i = 0; i < 7; i++) some[i] = rs[i + 1];
        (address[] memory tins, bytes32[] memory salts) = _sorted(some);
        uint256 val = pool.ethPerTin() * 7;
        vm.prank(op);
        pool.executeRound{value: val}(id, tins, salts);
        skip(61 minutes);
        vm.prank(attestors[0]);
        vm.expectRevert(Bonds.BadEvidence.selector);
        bonds.proposeOmission(op2, id, tinCommit, at, abi.encodePacked(r, s, v), 1);
    }

    function test_futureReceiptTimeProvesNothingForTheOperator() public {
        _bondOperator();
        (uint256 id, Req[] memory rs) = _fullRound(8);
        uint256 tinCommit = pool.tinCommitOf(rs[0].tin, rs[0].salt, 25e6, id);
        uint64 future = uint64(vm.getBlockTimestamp() + 365 days);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(opKey, bonds.receiptDigest(id, tinCommit, future));
        Req[] memory some = new Req[](7);
        for (uint256 i = 0; i < 7; i++) some[i] = rs[i + 1];
        (address[] memory tins, bytes32[] memory salts) = _sorted(some);
        uint256 val = pool.ethPerTin() * 7;
        vm.prank(op);
        pool.executeRound{value: val}(id, tins, salts);
        skip(61 minutes);
        // receivedAt after close: not provable either way, so the client must reject such a
        // receipt (packages/client checks receivedAt <= now).
        vm.prank(attestors[0]);
        vm.expectRevert(Bonds.BadEvidence.selector);
        bonds.proposeOmission(op, id, tinCommit, future, abi.encodePacked(r, s, v), 1);
    }

    function test_unapprovedSlashExpiresAndFreesTheBond() public {
        _bondOperator();
        vm.prank(attestors[0]);
        uint256 s = bonds.proposeBadReveal(op, bytes32(uint256(1)), 1);
        vm.expectRevert(Bonds.TooEarly.selector);
        bonds.expire(s);
        skip(7 days + 1);
        vm.prank(attestors[1]);
        vm.expectRevert(Bonds.NotApproved.selector); // too late to vote
        bonds.vote(s);
        bonds.expire(s);
        (,, uint32 open) = bonds.bonds(op, Bonds.Role.Operator);
        assertEq(open, 0);
    }

    function test_replacedAttestorsVotesDoNotCount() public {
        _bondOperator();
        vm.prank(attestors[0]);
        uint256 s = bonds.proposeBadReveal(op, bytes32(uint256(1)), 1);
        vm.prank(attestors[1]);
        bonds.vote(s);
        vm.prank(owner);
        bonds.setAttestors(attestors); // new epoch (same people, for brevity)
        vm.prank(attestors[2]);
        vm.expectRevert(Bonds.NotApproved.selector);
        bonds.vote(s);
        bonds.expire(s); // a stale-epoch proposal can be closed at once
    }

    function test_onlyAttestorsPropose() public {
        _bondOperator();
        vm.expectRevert(Bonds.NotAttestor.selector);
        bonds.proposeBadReveal(op, bytes32(uint256(1)), 1);
    }
}
