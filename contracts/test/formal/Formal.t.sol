// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StashPool, Verifiers} from "../../src/StashPool.sol";
import {ScreeningGate} from "../../src/ScreeningGate.sol";
import {FeeRouter, IRewardNotifier} from "../../src/FeeRouter.sol";
import {IUSDG} from "../../src/interfaces/IUSDG.sol";
import {IJoinsplitVerifier, IPpoiVerifier, ITinRequestVerifier} from "../../src/interfaces/IVerifiers.sol";
import {Hashers, IPoseidonT3, IPoseidonT4} from "../../src/interfaces/IPoseidon.sol";
import {MockUSDG} from "../mocks/MockUSDG.sol";

/// A Poseidon stand-in: the checks below never touch the tree, they only need the pool built.
contract ZeroHash {
    function hash(uint256[2] calldata) external pure returns (uint256) {
        return 1;
    }

    function hash(uint256[3] calldata) external pure returns (uint256) {
        return 1;
    }
}

/// Exposes the pool's fee rounding exactly as StashPool compiles it.
contract BpsHarness is StashPool {
    constructor(IUSDG u, ScreeningGate g, Verifiers memory v, Hashers memory h) StashPool(u, g, v, h, msg.sender, msg.sender) {}

    function bpsCeil(uint256 amount, uint256 bps) external pure returns (uint256) {
        return _bpsCeil(amount, bps);
    }
}

/// Records what the router streams to stakers, like FoilStaking.notifyRewardAmount.
contract PullNotifier is IRewardNotifier {
    IERC20 immutable usdg;

    constructor(IERC20 u) {
        usdg = u;
    }

    function notifyRewardAmount(uint256 amount) external {
        usdg.transferFrom(msg.sender, address(this), amount);
    }
}

/// Symbolic checks (Halmos; core math). Run from contracts/:
///   halmos --match-contract FormalTest
/// Each `check_` holds for every input, not just sampled ones.
contract FormalTest is Test {
    MockUSDG usdg;
    BpsHarness pool;
    FeeRouter router;
    PullNotifier staking;
    address constant WORK = address(0x1001);
    address constant TREASURY = address(0x1002);
    address constant BURN = address(0x1003);

    function setUp() public {
        usdg = new MockUSDG();
        ZeroHash z = new ZeroHash();
        address v = address(z);
        pool = new BpsHarness(
            IUSDG(address(usdg)), new ScreeningGate(address(this)),
            Verifiers(IJoinsplitVerifier(v), ITinRequestVerifier(v), IPpoiVerifier(v)),
            Hashers(IPoseidonT3(address(z)), IPoseidonT4(address(z)))
        );
        staking = new PullNotifier(IERC20(address(usdg)));
        router = new FeeRouter(IERC20(address(usdg)), address(this), WORK, TREASURY, staking, BURN);
    }

    /// Fees round up and never by more than one unit: the pool never undercharges. `bps` is
    /// each rate the pool uses (deposit and tin 15, withdrawal and send-back excess 25).
    /// Proved for amounts below 2^48 base units (~$281M per call, far above every cap); the
    /// solver cannot close 256-bit division in reasonable time. Fuzz tests cover the rest.
    function check_bpsCeilRoundsUpByLessThanOneUnit(uint256 amount, bool withdrawRate) public view {
        vm.assume(amount < 1 << 48);
        uint256 bps = withdrawRate ? pool.WITHDRAW_FEE_BPS() : pool.DEPOSIT_FEE_BPS();
        uint256 f = pool.bpsCeil(amount, bps);
        assert(f * 10_000 >= amount * bps);
        assert(f * 10_000 < amount * bps + 10_000);
        assert(f <= amount || amount == 0);
    }

    /// A tin request reserves its size plus every fee, for any size and allowed gas fee.
    function check_reservedForCoversSizeAndFees(uint256 size) public view {
        vm.assume(size < 1 << 120);
        uint256 r = pool.reservedFor(size);
        assert(r == size + pool.bpsCeil(size, pool.TIN_FEE_BPS()) + pool.TIN_FEE_FLAT() + pool.gasFeeUsdg());
        assert(r > size);
    }

    /// distribute() pays out exactly what it holds, 80/10/5 rounded down and the burn takes the
    /// remainder, and leaves nothing behind (no dust, no loss).
    /// Proved for balances below 2^48 base units (~$281M per distribute).
    function check_feeSplitConservesEveryUnit(uint256 total) public {
        vm.assume(total >= router.MIN_DISTRIBUTE() && total < 1 << 48);
        usdg.mint(address(router), total);
        router.distribute();
        uint256 w = usdg.balanceOf(WORK);
        uint256 t = usdg.balanceOf(TREASURY);
        uint256 s = usdg.balanceOf(address(staking));
        uint256 b = usdg.balanceOf(BURN);
        assert(w + t + s + b == total);
        assert(w == total * 8_000 / 10_000 && t == total * 1_000 / 10_000 && s == total * 500 / 10_000);
        assert(b >= total * 500 / 10_000 && b <= total * 500 / 10_000 + 3);
        assert(usdg.balanceOf(address(router)) == 0);
    }

    /// Below the minimum, distribute() is a no-op: dust can never restart the stakers' stream.
    function check_dustNeverDistributes(uint256 total) public {
        vm.assume(total < router.MIN_DISTRIBUTE());
        usdg.mint(address(router), total);
        assert(router.distribute() == 0);
        assert(usdg.balanceOf(address(router)) == total);
    }
}
