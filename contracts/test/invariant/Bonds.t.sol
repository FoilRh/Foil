// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FOIL} from "../../src/FOIL.sol";
import {Bonds} from "../../src/Bonds.sol";
import {StashPool} from "../../src/StashPool.sol";

/// The two pool reads Bonds needs for these paths: the operator allowlist and round times.
contract PoolStub {
    struct Round {
        uint64 openedAt;
        uint64 closedAt;
        uint64 executedAt;
        uint32 count;
    }

    mapping(address => bool) public operators;
    mapping(uint256 => Round) public rounds;

    function setOperator(address who, bool on) external {
        operators[who] = on;
    }

    function setRound(uint256 id, uint64 closedAt, uint64 executedAt) external {
        rounds[id] = Round(closedAt, closedAt, executedAt, 8);
    }
}

/// Bonders (paying for themselves or through bondFor), attestors of two rotating sets,
/// the owner rotating them, and time. Each call predicts success or the exact revert.
contract BondsHandler is Test {
    Bonds public bonds;
    FOIL public foil;
    PoolStub public pool;
    address public owner;
    address public treasury;
    address[] public actors;
    address[] setA;
    address[] setB;
    bool onB;
    uint256[] public ids;
    uint256 nextRound = 1;

    uint256 public ghostSlashed;
    uint256 public nBond; uint256 public nUnbond; uint256 public nWithdraw; uint256 public nBlocked;
    uint256 public nPropose; uint256 public nVote; uint256 public nExecute; uint256 public nExpire; uint256 public nRotate;

    constructor(Bonds b, FOIL f, PoolStub p, address o, address t) {
        (bonds, foil, pool, owner, treasury) = (b, f, p, o, t);
        for (uint256 i = 0; i < 4; i++) actors.push(makeAddr(string(abi.encode("bonder", i))));
        for (uint256 i = 0; i < 5; i++) {
            setA.push(makeAddr(string(abi.encode("attestorA", i))));
            setB.push(makeAddr(string(abi.encode("attestorB", i))));
        }
    }

    function initAttestors() external {
        vm.prank(owner);
        bonds.setAttestors(setA);
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function idCount() external view returns (uint256) {
        return ids.length;
    }

    /// Half the time one of the three newest proposals: old ones are mostly closed.
    function _pick(uint256 seed) internal view returns (uint256) {
        uint256 n = ids.length;
        if (seed % 2 == 0) return ids[n - 1 - (seed / 2) % (n < 3 ? n : 3)];
        return ids[seed % n];
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _role(bool operator) internal pure returns (Bonds.Role) {
        return operator ? Bonds.Role.Operator : Bonds.Role.Relayer;
    }

    function _attestor(uint256 seed) internal view returns (address) {
        return onB ? setB[seed % 5] : setA[seed % 5];
    }

    function _slash(uint256 id) internal view returns (Bonds.Slash memory s) {
        (s.who, s.role, s.cause, s.approvedAt, s.votes, s.executed, s.expired, s.proposedAt, s.epoch, s.amount, s.evidence) =
            bonds.slashes(id);
    }

    function _bond(address who, Bonds.Role r) internal view returns (uint256 amount, uint64 unbondAt, uint32 open) {
        return bonds.bonds(who, r);
    }

    function bond(uint256 who, bool operator, bool viaPayer) external {
        address a = _actor(who);
        Bonds.Role r = _role(operator);
        (uint256 amount,,) = _bond(a, r);
        address payer = viaPayer ? makeAddr("deployer") : a;
        uint256 need = bonds.required(r);
        foil.transfer(payer, need);
        vm.startPrank(payer);
        foil.approve(address(bonds), need);
        if (amount != 0) vm.expectRevert(Bonds.AlreadyBonded.selector);
        if (viaPayer) bonds.bondFor(a, r);
        else bonds.bond(r);
        vm.stopPrank();
        if (amount != 0) {
            vm.prank(payer);
            foil.transfer(address(this), need);
            return;
        }
        (uint256 after_,,) = _bond(a, r);
        assertEq(after_, need);
        nBond++;
    }

    function requestUnbond(uint256 who, bool operator) external {
        address a = _actor(who);
        Bonds.Role r = _role(operator);
        (uint256 amount, uint64 unbondAt,) = _bond(a, r);
        vm.prank(a);
        if (amount == 0) vm.expectRevert(Bonds.NotBonded.selector);
        else if (unbondAt != 0) vm.expectRevert(Bonds.Unbonding.selector);
        bonds.requestUnbond(r);
        if (amount != 0 && unbondAt == 0) nUnbond++;
    }

    function withdraw(uint256 who, bool operator, uint256 seed) external {
        address a = _actor(who);
        Bonds.Role r = _role(operator);
        (uint256 amount, uint64 unbondAt, uint32 open) = _bond(a, r);
        if (unbondAt != 0 && vm.getBlockTimestamp() < unbondAt && seed % 4 == 1) vm.warp(unbondAt);
        bool timeOk = unbondAt != 0 && vm.getBlockTimestamp() >= unbondAt;
        bool still = operator && pool.operators(a);
        uint256 before = foil.balanceOf(a);
        vm.prank(a);
        if (!timeOk) vm.expectRevert(Bonds.TooEarly.selector);
        else if (open != 0) vm.expectRevert(Bonds.SlashPending.selector);
        else if (still) vm.expectRevert(Bonds.StillOperator.selector);
        bonds.withdraw(r);
        if (!timeOk || open != 0 || still) {
            if (timeOk && open != 0) nBlocked++;
            return;
        }
        assertEq(foil.balanceOf(a) - before, amount);
        (uint256 left, uint64 at, uint32 o) = _bond(a, r);
        assertEq(left + at + o, 0, "bond deleted");
        nWithdraw++;
    }

    /// Operator-bond slash: BadReveal (judged off-chain) or Liveness (a late round).
    function propose(uint256 att, uint256 who, uint256 amount, bool liveness) external {
        address a = _actor(who);
        amount = bound(amount, 0, 40_000e18);
        (uint256 bonded,, uint32 open) = _bond(a, Bonds.Role.Operator);
        uint256 rid = nextRound++;
        pool.setRound(rid, uint64(vm.getBlockTimestamp() - 61 minutes), 0);
        uint256 id;
        vm.prank(_attestor(att));
        if (bonded == 0) vm.expectRevert(Bonds.NotBonded.selector);
        if (liveness) id = bonds.proposeLiveness(a, rid, amount);
        else id = bonds.proposeBadReveal(a, bytes32(ids.length), amount);
        if (bonded == 0) return;
        (,, uint32 open2) = _bond(a, Bonds.Role.Operator);
        assertEq(open2, open, "one attestor's proposal does not block the bond");
        assertEq(id, ids.length);
        ids.push(id);
        nPropose++;
    }

    function proposeByStranger(uint256 who) external {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(Bonds.NotAttestor.selector);
        bonds.proposeBadReveal(_actor(who), bytes32(0), 1);
    }

    function vote(uint256 att, uint256 idSeed) external {
        if (ids.length == 0) return;
        uint256 id = _pick(idSeed);
        Bonds.Slash memory s = _slash(id);
        address v = _attestor(att);
        // Mostly pick an attestor who has not voted yet, so proposals reach approval.
        for (uint256 k = 0; k < 5 && att % 4 != 3 && bonds.voted(id, v); k++) v = _attestor(att % 5 + k + 1);
        bool open = !s.executed && !s.expired && s.epoch == bonds.attestorEpoch()
            && vm.getBlockTimestamp() <= uint256(s.proposedAt) + bonds.VOTE_WINDOW();
        bool already = bonds.voted(id, v);
        vm.prank(v);
        if (!open) vm.expectRevert(Bonds.NotApproved.selector);
        else if (already) vm.expectRevert(Bonds.AlreadyVoted.selector);
        bonds.vote(id);
        if (!open || already) return;
        Bonds.Slash memory t = _slash(id);
        assertEq(t.votes, s.votes + 1);
        (,, uint32 openAfter) = _bond(s.who, s.role);

        if (t.votes == 2) assertGe(openAfter, 1, "a second vote makes it block the bond");

        if (t.votes == 3) assertEq(t.approvedAt, vm.getBlockTimestamp());
        else assertEq(t.approvedAt, s.approvedAt);
        nVote++;
    }

    function execute(uint256 idSeed, uint256 seed) external {
        if (ids.length == 0) return;
        uint256 id = _pick(idSeed);
        Bonds.Slash memory s = _slash(id);
        if (s.approvedAt != 0 && vm.getBlockTimestamp() < s.approvedAt + bonds.SLASH_DELAY() && seed % 2 == 0) {
            vm.warp(s.approvedAt + bonds.SLASH_DELAY());
        }
        (uint256 bonded,, uint32 open) = _bond(s.who, s.role);
        bool ok = s.approvedAt != 0 && !s.executed && !s.expired;
        bool late = vm.getBlockTimestamp() >= uint256(s.approvedAt) + bonds.SLASH_DELAY();
        uint256 before = foil.balanceOf(treasury);
        if (!ok) vm.expectRevert(Bonds.NotApproved.selector);
        else if (!late) vm.expectRevert(Bonds.TooEarly.selector);
        bonds.execute(id);
        if (!ok || !late) return;
        uint256 taken = s.amount > bonded ? bonded : s.amount;
        assertEq(foil.balanceOf(treasury) - before, taken, "capped at the bond");
        (uint256 left,, uint32 open2) = _bond(s.who, s.role);
        assertEq(left, bonded - taken);
        assertEq(open2, open - 1);
        ghostSlashed += taken;
        nExecute++;
    }

    function expire(uint256 idSeed, uint256 seed) external {
        if (ids.length == 0) return;
        uint256 id = _pick(idSeed);
        Bonds.Slash memory s = _slash(id);
        if (seed % 8 == 5 && vm.getBlockTimestamp() <= uint256(s.proposedAt) + bonds.VOTE_WINDOW()) {
            vm.warp(uint256(s.proposedAt) + bonds.VOTE_WINDOW() + 1);
        }
        bool closable = !s.executed && !s.expired && s.approvedAt == 0;
        bool stale = s.epoch != bonds.attestorEpoch() || vm.getBlockTimestamp() > uint256(s.proposedAt) + bonds.VOTE_WINDOW();
        if (!closable) vm.expectRevert(Bonds.NotApproved.selector);
        else if (!stale) vm.expectRevert(Bonds.TooEarly.selector);
        bonds.expire(id);
        if (closable && stale) nExpire++;
    }

    /// Rare on purpose: each rotation strands every open proposal of the old epoch.
    function rotateAttestors(uint256 seed) external {
        if (seed % 32 != 7) return; // not 0: the fuzzer favours 0
        vm.prank(owner);
        bonds.setAttestors(onB ? setA : setB);
        onB = !onB;
        nRotate++;
    }

    function setOperator(uint256 who, bool on) external {
        pool.setOperator(_actor(who), on);
    }

    function warp(uint256 dt) external {
        vm.warp(vm.getBlockTimestamp() + bound(dt, 0, 1 days));
    }
}

/// forge-config: default.invariant.fail-on-revert = true
/// forge-config: deep.invariant.fail-on-revert = true
contract BondsInvariant is Test {
    BondsHandler handler;
    Bonds bonds;
    FOIL foil;
    address owner = makeAddr("timelock");
    address treasury = makeAddr("treasury");

    function setUp() public {
        vm.warp(1_800_000_000);
        foil = new FOIL(address(this), 1_000_000_000e18);
        PoolStub pool = new PoolStub();
        bonds = new Bonds(IERC20(address(foil)), StashPool(address(pool)), treasury, owner);
        handler = new BondsHandler(bonds, foil, pool, owner, treasury);
        handler.initAttestors();
        foil.transfer(address(handler), foil.totalSupply());
        targetContract(address(handler));
        excludeSelector(FuzzSelector(address(handler), _one(handler.initAttestors.selector)));
    }

    function _one(bytes4 s) internal pure returns (bytes4[] memory a) {
        a = new bytes4[](1);
        a[0] = s;
    }

    function invariant_foilHeldEqualsSumOfBonds() public view {
        uint256 sum;
        for (uint256 i = 0; i < handler.actorCount(); i++) {
            (uint256 r,,) = bonds.bonds(handler.actors(i), Bonds.Role.Relayer);
            (uint256 o,,) = bonds.bonds(handler.actors(i), Bonds.Role.Operator);
            sum += r + o;
        }
        assertEq(foil.balanceOf(address(bonds)), sum);
        assertEq(foil.balanceOf(treasury), handler.ghostSlashed(), "slashed FOIL only goes to the treasury");
    }

    /// openSlashes counts exactly the bond's open (not executed, not expired) proposals with 2+ votes.
    function invariant_openSlashesMatchProposals() public view {
        uint256 n = handler.idCount();
        for (uint256 i = 0; i < handler.actorCount(); i++) {
            address a = handler.actors(i);
            for (uint256 r = 0; r < 2; r++) {
                uint256 count;
                for (uint256 k = 0; k < n; k++) {
                    (address who, Bonds.Role role,,, uint8 votes, bool executed, bool expired,,,,) = bonds.slashes(handler.ids(k));
                    if (who == a && uint256(role) == r && !executed && !expired && votes >= 2) count++;
                }
                (,, uint32 open) = bonds.bonds(a, Bonds.Role(r));
                assertEq(open, count);
            }
        }
    }

    function invariant_slashStateIsConsistent() public view {
        for (uint256 k = 0; k < handler.idCount(); k++) {
            (,,, uint64 approvedAt, uint8 votes, bool executed, bool expired,,,,) = bonds.slashes(handler.ids(k));
            assertFalse(executed && expired);
            assertEq(approvedAt != 0, votes >= 3);
            assertLe(votes, 5);
            if (executed) assertTrue(approvedAt != 0);
            if (expired) assertEq(approvedAt, 0);
        }
    }

    /// A bond with openSlashes > 0 cannot be withdrawn, however long its holder waits.
    function invariant_openSlashBlocksWithdraw() public {
        uint256 snap = vm.snapshotState();
        for (uint256 i = 0; i < handler.actorCount(); i++) {
            address a = handler.actors(i);
            for (uint256 r = 0; r < 2; r++) {
                Bonds.Role role = Bonds.Role(r);
                (uint256 amount, uint64 unbondAt, uint32 open) = bonds.bonds(a, role);
                if (open == 0 || (amount == 0 && unbondAt == 0)) continue;
                if (unbondAt == 0) {
                    vm.prank(a);
                    bonds.requestUnbond(role);
                }
                vm.warp(vm.getBlockTimestamp() + 30 days);
                vm.prank(a);
                try bonds.withdraw(role) {
                    fail();
                } catch (bytes memory err) {
                    assertEq(bytes4(err), Bonds.SlashPending.selector);
                }
            }
        }
        vm.revertToState(snap);
    }

    function afterInvariant() public view {
        console.log("bond unbond withdraw", handler.nBond(), handler.nUnbond(), handler.nWithdraw());
        console.log("blocked propose vote", handler.nBlocked(), handler.nPropose(), handler.nVote());
        console.log("execute expire rotate", handler.nExecute(), handler.nExpire(), handler.nRotate());
    }
}
