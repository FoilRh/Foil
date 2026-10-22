// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FOIL} from "../../src/FOIL.sol";
import {FeeRouter, IRewardNotifier} from "../../src/FeeRouter.sol";
import {FoilStaking} from "../../src/FoilStaking.sol";
import {MockUSDG} from "../mocks/MockUSDG.sol";

/// Four stakers stake, exit (inside and outside the window), claim; the owner (timelock)
/// covers losses; fees reach the stream only through FeeRouter.distribute(). Every call
/// asserts its own effect; fail-on-revert makes any unexpected revert a failure.
contract StakingHandler is Test {
    FoilStaking public staking;
    FOIL public foil;
    MockUSDG public usdg;
    FeeRouter public router;
    address public owner;
    address public lossSink = makeAddr("operator-float");
    address[] public actors;

    uint256 public ghostNotified; // USDG that reached the staking contract
    uint256 public ghostClaimed;
    uint256 public ghostCovered;
    uint256 public checkpoints; // user checkpoints: each may floor < 1 unit of reward
    uint256 public nStake; uint256 public nExit; uint256 public nWithdraw; uint256 public nExpired;
    uint256 public nClaim; uint256 public nCover; uint256 public nNotify; uint256 public nSettle;

    constructor(FoilStaking s, FOIL f, MockUSDG u, FeeRouter r, address o) {
        (staking, foil, usdg, router, owner) = (s, f, u, r, o);
        for (uint256 i = 0; i < 4; i++) actors.push(makeAddr(string(abi.encode("staker", i))));
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function stake(uint256 who, uint256 amount) external {
        address a = _actor(who);
        amount = bound(amount, 1e6, 1_000_000e18);
        uint256 ts = staking.totalShares();
        uint256 tf = staking.totalFoil();
        uint256 s = ts == 0 || tf == 0 ? amount : amount * ts / tf;
        if (s == 0) return;
        foil.transfer(a, amount);
        uint256 before = staking.shares(a);
        vm.startPrank(a);
        foil.approve(address(staking), amount);
        staking.stake(amount);
        vm.stopPrank();
        assertEq(staking.shares(a) - before, s, "shares at the current rate");
        checkpoints++;
        nStake++;
    }

    function requestExit(uint256 who, uint256 s) external {
        address a = _actor(who);
        s = bound(s, 0, staking.shares(a));
        vm.prank(a);
        staking.requestExit(s);
        assertEq(staking.exitAt(a), s == 0 ? 0 : vm.getBlockTimestamp() + staking.COOLDOWN());
        checkpoints++;
        nExit++;
    }

    function requestTooMuch(uint256 who, uint256 extra) external {
        address a = _actor(who);
        uint256 s = staking.shares(a) + bound(extra, 1, 1e30);
        vm.prank(a);
        vm.expectRevert(FoilStaking.TooMuch.selector);
        staking.requestExit(s);
    }

    /// Withdraws inside the window (warping into it if early) or proves a late one fails.
    function withdraw(uint256 who, uint256 seed) external {
        address a = _actor(who);
        uint256 s = staking.exitShares(a);
        if (s == 0) {
            vm.prank(a);
            vm.expectRevert(FoilStaking.Cooldown.selector);
            staking.withdraw();
            return;
        }
        uint256 at = staking.exitAt(a);
        if (vm.getBlockTimestamp() < at) {
            if (seed % 4 == 0) {
                vm.prank(a);
                vm.expectRevert(FoilStaking.Cooldown.selector);
                staking.withdraw();
            }
            vm.warp(at + bound(seed, 0, staking.EXIT_WINDOW()));
        }
        if (vm.getBlockTimestamp() > at + staking.EXIT_WINDOW()) {
            vm.prank(a);
            vm.expectRevert(FoilStaking.ExitExpired.selector);
            staking.withdraw();
            nExpired++;
            return;
        }
        uint256 expected = s * staking.totalFoil() / staking.totalShares();
        uint256 before = foil.balanceOf(a);
        vm.prank(a);
        staking.withdraw();
        assertEq(foil.balanceOf(a) - before, expected, "post-loss rate");
        assertEq(staking.exitShares(a), 0);
        checkpoints++;
        nWithdraw++;
    }

    function claim(uint256 who) external {
        address a = _actor(who);
        uint256 expected = staking.earned(a);
        uint256 before = usdg.balanceOf(a);
        vm.prank(a);
        staking.claim();
        uint256 got = usdg.balanceOf(a) - before;
        assertEq(got, expected, "claim pays earned()");
        assertEq(staking.earned(a), 0);
        ghostClaimed += got;
        checkpoints++;
        nClaim++;
    }

    function cover(uint256 amount) external {
        uint256 max = staking.totalFoil() * staking.MAX_COVER_BPS() / 10_000;
        if (max == 0) return;
        amount = bound(amount, 1, max);
        vm.prank(owner);
        staking.cover(lossSink, amount, "float");
        ghostCovered += amount;
        nCover++;
    }

    function coverTooMuch(uint256 amount) external {
        uint256 tf = staking.totalFoil();
        amount = bound(amount, tf * staking.MAX_COVER_BPS() / 10_000 + 1, tf + 1e24);
        vm.prank(owner);
        vm.expectRevert(FoilStaking.TooMuch.selector);
        staking.cover(lossSink, amount, "float");
    }

    /// Fees arrive at the router and anyone distributes; below $10 nothing moves.
    function notify(uint256 amount) external {
        amount = bound(amount, 0, 200_000e6);
        usdg.mint(address(router), amount);
        uint256 held = usdg.balanceOf(address(router));
        uint256 before = usdg.balanceOf(address(staking));
        uint256 total = router.distribute();
        uint256 got = usdg.balanceOf(address(staking)) - before;
        if (held < router.MIN_DISTRIBUTE()) {
            assertEq(total + got, 0, "dust is a no-op");
            return;
        }
        assertEq(got, held * router.STAKERS_BPS() / 10_000);
        ghostNotified += got;
        nNotify++;
    }

    function warp(uint256 dt) external {
        vm.warp(vm.getBlockTimestamp() + bound(dt, 0, 3 days));
    }

    /// Runs the stream to its end while someone earns: everything streamed is claimable.
    function settle() external {
        if (staking.earningShares() == 0 || staking.periodFinish() == 0) return;
        if (vm.getBlockTimestamp() <= staking.periodFinish()) vm.warp(staking.periodFinish() + 1);
        assertLe(usdg.balanceOf(address(staking)) - sumEarned(), dustBound(), "stranded reward");
        nSettle++;
    }

    function sumEarned() public view returns (uint256 t) {
        for (uint256 i = 0; i < actors.length; i++) t += staking.earned(actors[i]);
    }

    /// earned() floors per user and per checkpoint; rewardPerShare floors far below 1 unit.
    function dustBound() public view returns (uint256) {
        return checkpoints + actors.length + 1;
    }
}

/// forge-config: default.invariant.fail-on-revert = true
/// forge-config: deep.invariant.fail-on-revert = true
contract StakingInvariant is Test {
    StakingHandler handler;
    FoilStaking staking;
    FOIL foil;
    MockUSDG usdg;
    address owner = makeAddr("timelock");

    function setUp() public {
        vm.warp(1_800_000_000);
        usdg = new MockUSDG();
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 2);
        foil = new FOIL(address(this), 1_000_000_000e18);
        staking = new FoilStaking(IERC20(address(foil)), IERC20(address(usdg)), predicted, owner);
        FeeRouter router = new FeeRouter(
            IERC20(address(usdg)), owner, makeAddr("work"), makeAddr("treasury"), IRewardNotifier(address(staking)), makeAddr("burn")
        );
        assertEq(address(router), predicted);
        handler = new StakingHandler(staking, foil, usdg, router, owner);
        foil.transfer(address(handler), foil.totalSupply());
        targetContract(address(handler));
    }

    function invariant_foilHeldEqualsTotalFoil() public view {
        assertEq(foil.balanceOf(address(staking)), staking.totalFoil());
    }

    function invariant_sharesSumToTotal() public view {
        uint256 sum;
        for (uint256 i = 0; i < handler.actorCount(); i++) sum += staking.shares(handler.actors(i));
        assertEq(sum, staking.totalShares());
    }

    function invariant_exitSharesSumAndBound() public view {
        uint256 sum;
        for (uint256 i = 0; i < handler.actorCount(); i++) {
            address a = handler.actors(i);
            assertLe(staking.exitShares(a), staking.shares(a));
            assertEq(staking.exitAt(a) == 0, staking.exitShares(a) == 0);
            sum += staking.exitShares(a);
        }
        assertEq(sum, staking.totalExiting());
    }

    /// No over-promise: the USDG held covers every staker's earned(), and every unit
    /// notified is either claimed or still held.
    function invariant_rewardsCovered() public view {
        uint256 held = usdg.balanceOf(address(staking));
        assertGe(held, handler.sumEarned());
        assertEq(handler.ghostNotified(), handler.ghostClaimed() + held);
    }

    /// After the stream ends with earners present, nothing is stranded beyond rounding.
    function invariant_noStrandedRewardAfterStream() public view {
        if (staking.earningShares() == 0 || vm.getBlockTimestamp() < staking.periodFinish()) return;
        assertLe(usdg.balanceOf(address(staking)) - handler.sumEarned(), handler.dustBound());
    }

    function invariant_coverOnlyMovesToTheSink() public view {
        assertEq(foil.balanceOf(handler.lossSink()), handler.ghostCovered());
    }

    function afterInvariant() public view {
        console.log("stake exit withdraw", handler.nStake(), handler.nExit(), handler.nWithdraw());
        console.log("expired claim cover", handler.nExpired(), handler.nClaim(), handler.nCover());
        console.log("notify settle", handler.nNotify(), handler.nSettle());
    }
}
