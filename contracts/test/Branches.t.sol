// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Base, StashPoolHarness} from "./Base.t.sol";
import {RoundsBase} from "./Rounds.t.sol";
import {MockUSDG} from "./mocks/MockUSDG.sol";
import {DeployHashers} from "./utils/DeployHashers.sol";
import {IUSDG} from "../src/interfaces/IUSDG.sol";
import {Verifiers} from "../src/StashPool.sol";
import {IJoinsplitVerifier, ITinRequestVerifier, IPpoiVerifier} from "../src/interfaces/IVerifiers.sol";
import {TokenBase} from "./Token.t.sol";
import {StashPool} from "../src/StashPool.sol";
import {ScreeningGate} from "../src/ScreeningGate.sol";
import {FeeRouter, IRewardNotifier} from "../src/FeeRouter.sol";
import {FoilStaking} from "../src/FoilStaking.sol";
import {Bonds} from "../src/Bonds.sol";
import {Proof} from "../src/interfaces/IVerifiers.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Revert branches the scenario tests do not reach (found with forge coverage).
contract PoolBranchesTest is RoundsBase {
    function test_admitPathsNeedAPendingEntryAndValidProofs() public {
        vm.prank(provider1);
        gate.updateRoot(111); // RoundsBase's warp left both roots stale
        vm.prank(provider2);
        gate.updateRoot(222);
        uint256 seq = _deposit(alice, 30e6, 1);
        verifier.setAccept(false);
        vm.expectRevert(StashPool.InvalidProof.selector);
        pool.admitWithProofs(seq, new Proof[](2));
        verifier.setAccept(true);
        pool.admitWithSignatures(seq, _providerSigs(pool.admitDigest(seq)));
        bytes[] memory sigs = _providerSigs(pool.admitDigest(seq));
        vm.expectRevert(StashPool.BadEntryState.selector);
        pool.admitWithSignatures(seq, sigs);
        vm.prank(provider1);
        vm.expectRevert(StashPool.BadEntryState.selector);
        pool.flag(seq);
    }

    function test_exitPendingExpires() public {
        uint256 seq = _deposit(alice, 30e6, 1);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(aliceKey, pool.exitDigest(seq, deadline));
        skip(1 hours + 1);
        vm.expectRevert(StashPool.Expired.selector);
        pool.exitPending(seq, deadline, sig);
    }

    function test_transactNeedsRecipientAndFieldCommitments() public {
        uint256 root = pool.lastRoot();
        StashPool.ExtData memory ext = StashPool.ExtData(address(0), -1e6, address(0), 0, "", "");
        vm.expectRevert(StashPool.BadExtData.selector);
        pool.transact(_proof(), root, [uint256(1), 2], [uint256(3), 4], ext);
        ext.recipient = alice;
        vm.expectRevert(StashPool.BadExtData.selector);
        pool.transact(_proof(), root, [uint256(1), 2], [FIELD, 4], ext);
    }

    function test_requestTinNeedsAValidProof() public {
        StashPool.TinRequestArgs memory a = _args(25e6, address(1), 0, 0);
        verifier.setAccept(false);
        vm.expectRevert(StashPool.InvalidProof.selector);
        pool.requestTin(_proof(), a);
    }

    function test_settlementGuards() public {
        (uint256 id, Req[] memory rs) = _fullRound(8);
        assertEq(pool.requestCount(id), 8);
        address[] memory tins = new address[](0);
        vm.prank(operator);
        vm.expectRevert(StashPool.BadRound.selector); // the new round is still open
        pool.executeRound(id + 1, tins, new bytes32[](0));
        skip(1 hours);
        vm.expectRevert(StashPool.BadReveal.selector);
        pool.selfExecute(id, rs[0].idx, rs[1].tin, rs[1].salt);
        vm.expectRevert(StashPool.NotSettleable.selector);
        pool.selfExecute(id, 99, rs[0].tin, rs[0].salt);
        vm.expectRevert(StashPool.NotSettleable.selector);
        pool.cancelRequest(id, 99, rs[0].secret);
    }

    function test_operatorThatRefusesEthBackReverts() public {
        (uint256 id, Req[] memory rs) = _fullRound(8);
        pool.cancelRequest(id, rs[0].idx, rs[0].secret); // its ETH comes back to the operator
        EthRefuser op = new EthRefuser();
        vm.prank(owner);
        pool.setOperator(address(op), true);
        mockBonds.set(address(op), true);
        (address[] memory tins, bytes32[] memory salts) = _sorted(rs);
        uint256 v = pool.ethPerTin() * tins.length;
        vm.expectRevert(StashPool.EthTransfer.selector);
        op.execute{value: v}(pool, id, tins, salts);
    }

    function test_sweepNeedsARouter() public {
        vm.expectRevert(StashPool.OutOfBounds.selector);
        pool.sweepFees();
    }

    function test_guardianSetAndPauseAuth() public {
        vm.expectRevert(StashPool.NotGuardian.selector);
        pool.pause(true, true);
        vm.startPrank(owner);
        vm.expectRevert(StashPool.ZeroAddress.selector);
        pool.setGuardian(address(0));
        address g = makeAddr("newGuardian");
        pool.setGuardian(g);
        vm.stopPrank();
        assertEq(pool.guardian(), g);
        vm.prank(guardian);
        vm.expectRevert(StashPool.NotGuardian.selector);
        pool.pause(true, false);
    }

    function test_gateRejectsStrangersAndIgnoresTheirSignatures() public {
        vm.expectRevert(ScreeningGate.NotProvider.selector);
        gate.updateRoot(5);
        uint256 seq = _deposit(alice, 30e6, 1);
        (, uint256 strangerKey) = makeAddrAndKey("not-a-provider");
        bytes32 h = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", pool.admitDigest(seq)));
        bytes[] memory sigs = _providerSigs(pool.admitDigest(seq));
        sigs[1] = _sign(strangerKey, h);
        vm.expectRevert(ScreeningGate.NotEnoughSignatures.selector);
        pool.admitWithSignatures(seq, sigs);
        // Re-activating a known provider does not list it twice.
        vm.startPrank(owner);
        gate.setProvider(provider1, false);
        gate.setProvider(provider1, true);
        vm.stopPrank();
        assertEq(gate.providerList(0), provider1);
        vm.expectRevert();
        gate.providerList(2);
    }
}

contract EthRefuser {
    function execute(StashPool pool, uint256 id, address[] calldata tins, bytes32[] calldata salts) external payable {
        pool.executeRound{value: msg.value}(id, tins, salts);
    }
}

contract TokenBranchesTest is TokenBase {
    function test_bondsConstructorAndAdminGuards() public {
        vm.expectRevert(Bonds.ZeroAddress.selector);
        new Bonds(IERC20(address(foilToken)), pool, address(0), owner);
        vm.expectRevert(Bonds.ZeroAddress.selector);
        bonds.bondFor(address(0), Bonds.Role.Relayer);

        address[] memory four = new address[](4);
        address[] memory dup = new address[](5);
        address[] memory zero = new address[](5);
        for (uint256 i = 0; i < 5; i++) {
            if (i < 4) four[i] = attestors[i];
            dup[i] = attestors[i == 4 ? 0 : i];
            zero[i] = i == 4 ? address(0) : attestors[i];
        }
        vm.startPrank(owner);
        vm.expectRevert(Bonds.BadAttestors.selector);
        bonds.setAttestors(four);
        vm.expectRevert(Bonds.BadAttestors.selector);
        bonds.setAttestors(dup);
        vm.expectRevert(Bonds.BadAttestors.selector);
        bonds.setAttestors(zero);
        vm.expectRevert(Bonds.ZeroAddress.selector);
        bonds.setTreasury(address(0));
        address t2 = makeAddr("treasury2");
        bonds.setTreasury(t2);
        vm.stopPrank();
        assertEq(bonds.treasury(), t2);
        vm.expectRevert();
        bonds.setTreasury(t2); // owner only
    }

    function test_bondsUnbondAndVoteGuards() public {
        vm.prank(op);
        vm.expectRevert(Bonds.NotBonded.selector);
        bonds.requestUnbond(Bonds.Role.Operator);
        _bondOperator();
        vm.prank(op);
        vm.expectRevert(Bonds.AlreadyBonded.selector);
        bonds.bond(Bonds.Role.Operator);
        vm.prank(attestors[0]);
        uint256 id = bonds.proposeBadReveal(op, bytes32(uint256(1)), 1);
        assertEq(bonds.slashCount(), 1);
        vm.expectRevert(Bonds.NotAttestor.selector);
        bonds.vote(id);
        vm.startPrank(op);
        bonds.requestUnbond(Bonds.Role.Operator);
        vm.expectRevert(Bonds.Unbonding.selector);
        bonds.requestUnbond(Bonds.Role.Operator);
        vm.stopPrank();
    }

    /// The vote window is inclusive: at exactly proposedAt + 7 days a vote still counts and
    /// the proposal cannot be expired yet; one second later the reverse.
    function test_voteWindowBoundaryIsInclusive() public {
        _bondOperator();
        vm.prank(attestors[0]);
        uint256 id = bonds.proposeBadReveal(op, bytes32(uint256(1)), 1);
        skip(bonds.VOTE_WINDOW());
        vm.expectRevert(Bonds.TooEarly.selector);
        bonds.expire(id);
        vm.prank(attestors[1]);
        bonds.vote(id);
        skip(1);
        vm.prank(attestors[2]);
        vm.expectRevert(Bonds.NotApproved.selector);
        bonds.vote(id);
        bonds.expire(id);
    }

    function test_omissionNeedsARequestedCommit() public {
        _bondOperator();
        (uint256 id,) = _fullRound(8);
        uint256 unknown = 12345;
        uint64 at = uint64(vm.getBlockTimestamp());
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(opKey, bonds.receiptDigest(id, unknown, at));
        vm.prank(attestors[0]);
        vm.expectRevert(Bonds.BadEvidence.selector);
        bonds.proposeOmission(op, id, unknown, at, abi.encodePacked(r, s, v), 1);
    }

    function test_routerRecipientsAreValidated() public {
        vm.startPrank(owner);
        vm.expectRevert(FeeRouter.ZeroAddress.selector);
        router.setRecipients(address(0), treasury, IRewardNotifier(address(staking)), burnSink);
        vm.expectRevert(FeeRouter.ZeroAddress.selector);
        router.setRecipients(work, treasury, IRewardNotifier(makeAddr("eoa")), burnSink);
        vm.expectRevert(FeeRouter.ZeroAddress.selector);
        router.setRecipients(work, treasury, IRewardNotifier(address(staking)), address(0));
        address w2 = makeAddr("work2");
        router.setRecipients(w2, treasury, IRewardNotifier(address(staking)), burnSink);
        vm.stopPrank();
        assertEq(router.work(), w2);
        vm.expectRevert();
        router.setRecipients(w2, treasury, IRewardNotifier(address(staking)), burnSink);
    }

    function test_stakingZeroAmountsAndEmptyClaim() public {
        vm.expectRevert(FoilStaking.ZeroAmount.selector);
        staking.stake(0);
        address a = makeAddr("nothing-earned");
        vm.prank(a);
        staking.claim(); // no-op
        vm.prank(address(router));
        staking.notifyRewardAmount(0); // no-op
        assertEq(staking.rewardRate(), 0); // nothing streams (periodFinish just tracks the idle clock)
        vm.prank(owner);
        vm.expectRevert(FoilStaking.TooMuch.selector);
        staking.cover(op, 0, "zero");
    }
}

/// A token that takes one extra unit from the sender on every transfer: the pool's
/// counters no longer match what it holds, which the `conserved` check must refuse.
contract LeakyUSDG is MockUSDG {
    function transfer(address to, uint256 amount) public override returns (bool) {
        _burn(msg.sender, 1);
        return super.transfer(to, amount);
    }
}

contract ConservationGuardTest is Base {
    function test_conservedRefusesATokenThatLeaksOnTransfer() public {
        LeakyUSDG leaky = new LeakyUSDG();
        address m = address(verifier);
        StashPoolHarness p = new StashPoolHarness(
            IUSDG(address(leaky)), gate, Verifiers(IJoinsplitVerifier(m), ITinRequestVerifier(m), IPpoiVerifier(m)),
            DeployHashers.deploy(), owner, guardian
        );
        leaky.mint(alice, 100e6);
        vm.startPrank(alice);
        leaky.approve(address(p), type(uint256).max);
        uint256 seq = p.deposit(100e6, 1, "", "");
        vm.stopPrank();
        skip(15 minutes);
        p.admitAfterStandby(seq);
        StashPool.ExtData memory ext = StashPool.ExtData(alice, -10e6, address(0), 0, "", "");
        uint256 root = p.lastRoot();
        vm.expectRevert(StashPool.Conservation.selector);
        p.transact(_proof(), root, [uint256(1), 2], [uint256(3), 4], ext);
    }
}
