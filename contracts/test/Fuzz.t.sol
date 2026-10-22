// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {RoundsBase} from "./Rounds.t.sol";
import {TokenBase} from "./Token.t.sol";
import {StashPool} from "../src/StashPool.sol";
import {FoilStaking} from "../src/FoilStaking.sol";
import {Bonds} from "../src/Bonds.sol";
import {Auth3009} from "../src/interfaces/IUSDG.sol";

/// Stateless fuzzing of the pool's entry points: every bound is hit from both sides.
contract PoolFuzzTest is RoundsBase {
    uint256 constant MAX_AMOUNT = 1 << 120;
    address bob = makeAddr("bob");
    address relayer = makeAddr("fuzz-relayer");

    function _ceil(uint256 a, uint256 bps) internal pure returns (uint256) {
        return (a * bps + 9_999) / 10_000;
    }

    function testFuzz_depositAmountBounds(uint256 amount) public {
        if (amount < pool.MIN_DEPOSIT() || amount >= MAX_AMOUNT) {
            vm.expectRevert(StashPool.BadAmount.selector);
            _deposit(alice, amount, 1);
            return;
        }
        usdg.mint(alice, amount);
        uint256 pending = pool.pendingTotal();
        uint256 seq = _deposit(alice, amount, 1);
        (,,,, uint256 gross, uint256 fee,) = pool.entries(seq);
        assertEq(gross, amount);
        assertEq(fee, _ceil(amount, 15));
        assertEq(pool.pendingTotal(), pending + amount);
    }

    function testFuzz_depositNpkMustBeAField(uint256 npk) public {
        if (npk < FIELD) {
            _deposit(alice, 1e6, npk);
            return;
        }
        vm.expectRevert(StashPool.BadAmount.selector);
        _deposit(alice, 1e6, npk);
    }

    function testFuzz_depositCaps(uint256 maxDeposit, uint256 maxTotal, uint256 amount) public {
        maxDeposit = bound(maxDeposit, 0, 10_000e6);
        maxTotal = maxTotal % 3 == 0 ? 0 : bound(maxTotal, maxDeposit, 300_000e6);
        amount = bound(amount, pool.MIN_DEPOSIT(), 300_000e6);
        vm.prank(owner);
        pool.setCaps(maxDeposit, maxTotal);
        usdg.mint(alice, amount);
        uint256 held = pool.totalIn() - pool.totalOut();
        bool over = (maxDeposit != 0 && amount > maxDeposit) || (maxTotal != 0 && held + amount > maxTotal);
        if (over) vm.expectRevert(StashPool.OverCap.selector);
        _deposit(alice, amount, 1);
    }

    function testFuzz_transactFeeCapAndPayout(uint256 fee, uint256 out) public {
        fee = bound(fee, 0, 3 * pool.MAX_RELAYER_FEE());
        out = bound(out, 0, 50_000e6);
        StashPool.ExtData memory ext = StashPool.ExtData(bob, -int256(out), relayer, fee, "", "");
        uint256 root = pool.lastRoot();
        if (fee > pool.MAX_RELAYER_FEE()) {
            vm.expectRevert(StashPool.BadExtData.selector);
            pool.transact(_proof(), root, [uint256(1), 2], [uint256(3), 4], ext);
            return;
        }
        uint256 fees = pool.feesAccrued();
        pool.transact(_proof(), root, [uint256(1), 2], [uint256(3), 4], ext);
        uint256 protocolFee = _ceil(out, 25);
        assertEq(usdg.balanceOf(bob), out - protocolFee);
        assertEq(usdg.balanceOf(relayer), fee);
        assertEq(pool.feesAccrued(), fees + protocolFee);
        assertEq(usdg.balanceOf(address(pool)), pool.totalIn() - pool.totalOut());
    }

    function testFuzz_transactExtAmountBounds(int256 extAmount) public {
        uint256 root = pool.lastRoot();
        if (extAmount > 0 || extAmount == type(int256).min || uint256(-extAmount) >= MAX_AMOUNT) {
            StashPool.ExtData memory bad = StashPool.ExtData(bob, extAmount, address(0), 0, "", "");
            if (extAmount == type(int256).min) vm.expectRevert(); // the negation overflows first
            else vm.expectRevert(StashPool.BadExtData.selector);
            pool.transact(_proof(), root, [uint256(1), 2], [uint256(3), 4], bad);
            return;
        }
        // In range: pays out unless it exceeds what the pool holds (conservation).
        uint256 out = uint256(-extAmount);
        StashPool.ExtData memory ext = StashPool.ExtData(bob, extAmount, address(0), 0, "", "");
        if (out > pool.totalIn() - pool.totalOut()) vm.expectRevert();
        pool.transact(_proof(), root, [uint256(1), 2], [uint256(3), 4], ext);
    }

    function testFuzz_requestTinSizes(uint256 size, uint256 pick) public {
        uint256[7] memory sizes = [uint256(10e6), 25e6, 50e6, 100e6, 250e6, 500e6, 1000e6];
        if (pick % 2 == 0) size = sizes[pick % 7];
        else size = bound(size, 0, 2_000e6);
        StashPool.TinRequestArgs memory a = _args(size, address(1), bytes32(pick), bytes32(pick));
        if (!pool.isTinSize(size)) {
            vm.expectRevert(StashPool.BadSize.selector);
            pool.requestTin(_proof(), a);
            return;
        }
        uint256 reserved = pool.reservedFor(size);
        assertEq(reserved, size + _ceil(size, 15) + pool.TIN_FEE_FLAT() + pool.gasFeeUsdg());
        uint256 before = pool.reservedTotal();
        uint256 idx = pool.requestTin(_proof(), a);
        assertEq(pool.reservedTotal(), before + reserved);
        StashPool.Request memory q = pool.getRequest(a.roundId, idx);
        assertEq(q.size, size);
        assertEq(q.reserved, reserved);
    }

    function testFuzz_requestTinFeeCap(uint256 fee) public {
        fee = bound(fee, 0, 3 * pool.MAX_RELAYER_FEE());
        StashPool.TinRequestArgs memory a = _args(25e6, address(1), 0, 0);
        a.fee = fee;
        if (fee > pool.MAX_RELAYER_FEE()) {
            vm.expectRevert(StashPool.BadExtData.selector);
            pool.requestTin(_proof(), a);
            return;
        }
        uint256 before = usdg.balanceOf(a.relayer);
        pool.requestTin(_proof(), a);
        assertEq(usdg.balanceOf(a.relayer) - before, fee);
    }

    /// The fee must equal 0.25% (rounded up) of the part above what the tin was funded
    /// with, cumulatively; anything else reverts.
    function testFuzz_returnToStashFeeBinding(uint256 first, uint256 value, uint256 wrong) public {
        (address tin, uint256 key) = makeAddrAndKey("fuzz-tin");
        pool.fundTinForTest(tin, 25e6);
        first = bound(first, 1e6, 40e6);
        value = bound(value, 1e6, 60e6);
        usdg.mint(tin, first + value);
        _sendBack(tin, key, first, first > 25e6 ? _ceil(first - 25e6, 25) : 0, 1);
        uint256 freeLeft = first >= 25e6 ? 0 : 25e6 - first;
        uint256 fee = value > freeLeft ? _ceil(value - freeLeft, 25) : 0;
        if (wrong % 2 == 1) {
            uint256 bad = bound(wrong, 0, 1e6);
            if (bad == fee) bad = fee + 1;
            Auth3009 memory a = _auth3009(key, tin, value, pool.sendBackNonce(2, bad, "", ""));
            vm.expectRevert(StashPool.BadAmount.selector);
            pool.returnToStash(a, bad, 2, "", "");
            return;
        }
        uint256 seq = _sendBack(tin, key, value, fee, 2);
        (,,,,, uint256 entryFee,) = pool.entries(seq);
        assertEq(entryFee, fee);
        assertEq(pool.tinSentBack(tin), first + value);
    }

    function _sendBack(address tin, uint256 key, uint256 value, uint256 fee, uint256 npk) internal returns (uint256) {
        Auth3009 memory a = _auth3009(key, tin, value, pool.sendBackNonce(npk, fee, "", ""));
        return pool.returnToStash(a, fee, npk, "", "");
    }
}

/// Stateless fuzzing of staking windows and rates, the fee split and bond timings.
contract TokenFuzzTest is TokenBase {
    address stakerA = makeAddr("fuzzStakerA");
    address stakerB = makeAddr("fuzzStakerB");

    function _stake(address who, uint256 amount) internal {
        vm.prank(safe);
        foilToken.transfer(who, amount);
        vm.startPrank(who);
        foilToken.approve(address(staking), amount);
        staking.stake(amount);
        vm.stopPrank();
    }

    function _distribute(uint256 total) internal returns (uint256 toStakers) {
        usdg.mint(address(router), total);
        router.distribute();
        toStakers = total * 500 / 10_000;
    }

    function testFuzz_stakeAtPostLossRate(uint256 a, uint256 coverAmt, uint256 c) public {
        a = bound(a, 1e18, 1_000_000e18);
        c = bound(c, 1e6, 1_000_000e18);
        _stake(stakerA, a);
        coverAmt = bound(coverAmt, 1, a * 3_000 / 10_000);
        vm.prank(owner);
        staking.cover(op, coverAmt, "float");
        uint256 ts = staking.totalShares();
        uint256 tf = staking.totalFoil();
        uint256 aBefore = staking.staked(stakerA);
        _stake(stakerB, c);
        assertEq(staking.shares(stakerB), c * ts / tf);
        assertLe(staking.staked(stakerB), c, "new stake never gains from old losses");
        assertApproxEqAbs(staking.staked(stakerB), c, 2);
        assertApproxEqAbs(staking.staked(stakerA), aBefore, 1, "no dilution of the old staker");
    }

    function testFuzz_requestExitBounds(uint256 a, uint256 s) public {
        a = bound(a, 1e6, 1_000_000e18);
        _stake(stakerA, a);
        s = bound(s, 0, 2 * a);
        vm.prank(stakerA);
        if (s > a) vm.expectRevert(FoilStaking.TooMuch.selector);
        staking.requestExit(s);
        if (s <= a) assertEq(staking.totalExiting(), s);
    }

    /// Withdraw works only in [exitAt, exitAt + 2 days].
    function testFuzz_exitWindow(uint256 a, uint256 dt) public {
        a = bound(a, 1e6, 1_000_000e18);
        dt = bound(dt, 0, 12 days);
        _stake(stakerA, a);
        vm.prank(stakerA);
        staking.requestExit(a);
        skip(dt);
        (uint256 cd, uint256 win) = (staking.COOLDOWN(), staking.EXIT_WINDOW());
        vm.prank(stakerA);
        if (dt < cd) vm.expectRevert(FoilStaking.Cooldown.selector);
        else if (dt > cd + win) vm.expectRevert(FoilStaking.ExitExpired.selector);
        staking.withdraw();
        if (dt >= cd && dt <= cd + win) {
            assertEq(foilToken.balanceOf(stakerA), a);
            assertEq(staking.totalShares(), 0);
        }
    }

    /// Shares in an exit request stay at risk but earn nothing; the rest earn it all.
    function testFuzz_exitingSharesStopEarning(uint256 part, uint256 total) public {
        _stake(stakerA, 1_000e18);
        _stake(stakerB, 1_000e18);
        part = bound(part, 0, 1_000e18);
        total = bound(total, 10e6, 1_000_000e6);
        vm.prank(stakerA);
        staking.requestExit(part);
        uint256 r = _distribute(total);
        skip(7 days);
        uint256 earnA = staking.earned(stakerA);
        uint256 earnB = staking.earned(stakerB);
        assertApproxEqAbs(earnA, r * (1_000e18 - part) / (2_000e18 - part), 2);
        assertApproxEqAbs(earnA + earnB, r, 2, "nothing stranded");
    }

    /// While nobody earns, the stream pauses: an idle gap delays rewards, never loses them.
    function testFuzz_streamPausesWhenNobodyEarns(uint256 idle, uint256 total) public {
        idle = bound(idle, 0, 60 days);
        total = bound(total, 10e6, 1_000_000e6);
        _stake(stakerA, 1_000e18);
        vm.prank(stakerA);
        staking.requestExit(1_000e18);
        uint256 r = _distribute(total);
        skip(idle);
        assertEq(staking.earned(stakerA), 0);
        vm.prank(stakerA);
        staking.requestExit(0); // cancel: earning again
        skip(7 days);
        assertApproxEqAbs(staking.earned(stakerA), r, 2);
    }

    function testFuzz_distributeSplitAndMinimum(uint256 total) public {
        total = bound(total, 0, 1e15);
        usdg.mint(address(router), total);
        uint256 got = router.distribute();
        if (total < router.MIN_DISTRIBUTE()) {
            assertEq(got, 0);
            assertEq(usdg.balanceOf(address(router)), total, "dust waits");
            assertEq(usdg.balanceOf(address(staking)), 0);
            return;
        }
        uint256 w = total * 8_000 / 10_000;
        uint256 t = total * 1_000 / 10_000;
        uint256 s = total * 500 / 10_000;
        assertEq(got, total);
        assertEq(usdg.balanceOf(work), w);
        assertEq(usdg.balanceOf(treasury), t);
        assertEq(usdg.balanceOf(address(staking)), s);
        assertEq(usdg.balanceOf(burnSink), total - w - t - s);
        assertEq(usdg.balanceOf(address(router)), 0);
        assertLe(total - w - t - s - total * 500 / 10_000, 3, "burn is 5% plus rounding dust");
    }

    /// Votes count only within 7 days; after that anyone can expire the proposal.
    function testFuzz_slashVoteWindowAndExpiry(uint256 dt) public {
        _bondOperator();
        dt = bound(dt, 0, 30 days);
        vm.prank(attestors[0]);
        uint256 id = bonds.proposeBadReveal(op, bytes32(uint256(1)), 1);
        skip(dt);
        bool open = dt <= bonds.VOTE_WINDOW();
        vm.prank(attestors[1]);
        if (!open) vm.expectRevert(Bonds.NotApproved.selector);
        bonds.vote(id);
        if (open) vm.expectRevert(Bonds.TooEarly.selector);
        bonds.expire(id);
        (,, uint32 openSlashes) = bonds.bonds(op, Bonds.Role.Operator);
        assertEq(openSlashes, open ? 1 : 0);
    }

    function testFuzz_slashExecuteDelayAndCap(uint256 amount, uint256 dt) public {
        _bondOperator();
        amount = bound(amount, 0, 100_000e18);
        dt = bound(dt, 0, 4 days);
        vm.prank(attestors[0]);
        uint256 id = bonds.proposeBadReveal(op, bytes32(uint256(1)), amount);
        vm.prank(attestors[1]);
        bonds.vote(id);
        vm.prank(attestors[2]);
        bonds.vote(id);
        skip(dt);
        if (dt < bonds.SLASH_DELAY()) {
            vm.expectRevert(Bonds.TooEarly.selector);
            bonds.execute(id);
            return;
        }
        bonds.execute(id);
        uint256 taken = amount > 30_000e18 ? 30_000e18 : amount;
        assertEq(foilToken.balanceOf(treasury), taken);
        (uint256 left,, uint32 openSlashes) = bonds.bonds(op, Bonds.Role.Operator);
        assertEq(left, 30_000e18 - taken);
        assertEq(openSlashes, 0);
        vm.expectRevert(Bonds.NotApproved.selector);
        bonds.execute(id);
    }

    function testFuzz_unbondDelay(uint256 dt) public {
        address relayer = makeAddr("fuzz-relayer-bond");
        dt = bound(dt, 0, 30 days);
        vm.startPrank(safe);
        foilToken.approve(address(bonds), 20_000e18);
        bonds.bondFor(relayer, Bonds.Role.Relayer); // paid by the safe, owned by the relayer
        vm.stopPrank();
        vm.prank(relayer);
        bonds.requestUnbond(Bonds.Role.Relayer);
        assertFalse(bonds.isBonded(relayer, Bonds.Role.Relayer));
        skip(dt);
        bool early = dt < bonds.UNBOND_DELAY();
        vm.prank(relayer);
        if (early) vm.expectRevert(Bonds.TooEarly.selector);
        bonds.withdraw(Bonds.Role.Relayer);
        if (!early) assertEq(foilToken.balanceOf(relayer), 20_000e18);
    }
}
