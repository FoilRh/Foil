// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {Base} from "../Base.t.sol";
import {StashPool, Verifiers} from "../../src/StashPool.sol";
import {MockUSDG} from "../mocks/MockUSDG.sol";
import {Auth3009} from "../../src/interfaces/IUSDG.sol";
import {Proof} from "../../src/interfaces/IVerifiers.sol";
import {StashPoolHarness} from "../Base.t.sol";

/// Drives the pool through random sequences. The mock verifier accepts any proof, so the
/// handler only spends what its ghost "shielded" balance says the user's notes hold —
/// exactly what real proofs enforce.
contract Handler is Test {
    uint256 constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    StashPoolHarness pool;
    MockUSDG usdg;
    address user;
    uint256 userKey;
    address operator;

    uint256 public ghostShielded;
    uint256 public nExec; uint256 public nCancel; uint256 public nSelf; uint256 public nSendBack; uint256 public nWithdraw; uint256 public nReq;
    uint256[] pendingSeqs;
    uint256 nonce = 1;

    struct Req {
        uint256 roundId;
        uint256 idx;
        address tin;
        uint256 tinKey;
        bytes32 salt;
        bytes32 secret;
    }

    Req[] reqs;
    address[] fundedTins;
    mapping(address => uint256) tinKeys;

    constructor(StashPoolHarness p, MockUSDG u, address user_, uint256 key, address op) {
        (pool, usdg, user, userKey, operator) = (p, u, user_, key, op);
    }

    function deposit(uint96 amount) external {
        uint256 a = bound(amount, 1e6, 50_000e6);
        usdg.mint(user, a);
        vm.prank(user);
        pendingSeqs.push(pool.deposit(a, nonce++, "", ""));
    }

    function admit(uint256 i) external {
        if (pendingSeqs.length == 0) return;
        uint256 seq = _takePending(i);
        (,,,, uint256 gross, uint256 fee,) = pool.entries(seq);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        pool.admitAfterStandby(seq);
        ghostShielded += gross - fee;
    }

    function exitPending(uint256 i) external {
        if (pendingSeqs.length == 0) return;
        uint256 seq = _takePending(i);
        (address origin,,,,,,) = pool.entries(seq);
        uint256 key = origin == user ? userKey : tinKeys[origin];
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, pool.exitDigest(seq, deadline));
        pool.exitPending(seq, deadline, abi.encodePacked(r, s, v));
    }

    function request(uint256 sizeIdx) external {
        uint256[3] memory sizes = [uint256(10e6), 25e6, 50e6];
        uint256 size = sizes[sizeIdx % 3];
        uint256 cost = pool.reservedFor(size) + 250_000;
        if (ghostShielded < cost) return;
        Req memory q;
        (q.tin, q.tinKey) = makeAddrAndKey(string(abi.encode("tin", nonce)));
        q.salt = bytes32(nonce);
        q.secret = bytes32(nonce + 7);
        q.roundId = pool.currentRound();
        StashPool.TinRequestArgs memory a;
        a.root = pool.lastRoot();
        a.nullifiers = [nonce++, nonce++];
        a.changeCommitment = nonce++;
        a.size = size;
        a.fee = 250_000;
        a.roundId = q.roundId;
        a.tinCommit = pool.tinCommitOf(q.tin, q.salt, size, q.roundId);
        a.refundCommit = nonce++;
        a.cancelHash = uint256(keccak256(abi.encode(q.secret))) % FIELD;
        a.relayer = address(0xBEEF);
        Proof memory p;
        q.idx = pool.requestTin(p, a);
        ghostShielded -= cost;
        tinKeys[q.tin] = q.tinKey;
        reqs.push(q);
        nReq++;
    }

    function close() external {
        vm.warp(vm.getBlockTimestamp() + 31 minutes);
        if (pool.canClose(pool.currentRound())) pool.closeRound();
    }

    function execute(uint256 i) external {
        if (reqs.length == 0) return;
        uint256 roundId = reqs[i % reqs.length].roundId;
        (, uint64 closedAt, uint64 executedAt,) = pool.rounds(roundId);
        if (closedAt == 0 || executedAt != 0) return;
        uint256 n;
        for (uint256 k = 0; k < reqs.length; k++) if (reqs[k].roundId == roundId) n++;
        address[] memory tins = new address[](n);
        bytes32[] memory salts = new bytes32[](n);
        n = 0;
        for (uint256 k = 0; k < reqs.length; k++) {
            if (reqs[k].roundId == roundId) (tins[n], salts[n++]) = (reqs[k].tin, reqs[k].salt);
        }
        for (uint256 a = 0; a < n; a++) {
            for (uint256 b = a + 1; b < n; b++) {
                if (tins[b] < tins[a]) {
                    (tins[a], tins[b]) = (tins[b], tins[a]);
                    (salts[a], salts[b]) = (salts[b], salts[a]);
                }
            }
        }
        uint256 v = pool.ethPerTin() * n;
        vm.deal(operator, v);
        vm.prank(operator);
        pool.executeRound{value: v}(roundId, tins, salts);
        for (uint256 k = 0; k < n; k++) fundedTins.push(tins[k]);
        nExec++;
    }

    function cancel(uint256 i) external {
        if (reqs.length == 0) return;
        Req memory q = reqs[i % reqs.length];
        StashPool.Request memory r = pool.getRequest(q.roundId, q.idx);
        if (r.state != StashPool.RequestState.Pending) return;
        pool.cancelRequest(q.roundId, q.idx, q.secret);
        ghostShielded += r.reserved;
        nCancel++;
    }

    function selfExecute(uint256 i) external {
        if (reqs.length == 0) return;
        Req memory q = reqs[i % reqs.length];
        StashPool.Request memory r = pool.getRequest(q.roundId, q.idx);
        (, uint64 closedAt,,) = pool.rounds(q.roundId);
        if (r.state != StashPool.RequestState.Pending || closedAt == 0) return;
        vm.warp(vm.getBlockTimestamp() + 61 minutes);
        pool.selfExecute(q.roundId, q.idx, q.tin, q.salt);
        fundedTins.push(q.tin);
        nSelf++;
    }

    function withdraw(uint96 amount) external {
        uint256 w = bound(amount, 0, ghostShielded > 250_000 ? ghostShielded - 250_000 : 0);
        if (w == 0) return;
        StashPool.ExtData memory ext = StashPool.ExtData(user, -int256(w), address(0xBEEF), 250_000, "", "");
        Proof memory p;
        pool.transact(p, pool.lastRoot(), [nonce++, nonce++], [nonce++, nonce++], ext);
        ghostShielded -= w + 250_000;
        nWithdraw++;
    }

    function sendBack(uint256 i, uint96 amount) external {
        if (fundedTins.length == 0) return;
        address tin = fundedTins[i % fundedTins.length];
        uint256 bal = usdg.balanceOf(tin);
        if (bal < 1e6 || pool.tinSendBacks(tin) >= 10) return;
        uint256 v = bound(amount, 1e6, bal);
        uint256 npk = nonce++;
        uint256 funded = pool.tinFunded(tin);
        uint256 sent = pool.tinSentBack(tin);
        uint256 freeLeft = funded > sent ? funded - sent : 0;
        uint256 fee = v > freeLeft ? ((v - freeLeft) * 25 + 9_999) / 10_000 : 0;
        bytes32 n = pool.sendBackNonce(npk, fee, "", "");
        bytes32 structHash = keccak256(
            abi.encode(usdg.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), tin, address(pool), v, 0, vm.getBlockTimestamp() + 1 hours, n)
        );
        (uint8 sv, bytes32 r, bytes32 s) =
            vm.sign(tinKeys[tin], keccak256(abi.encodePacked("\x19\x01", usdg.DOMAIN_SEPARATOR(), structHash)));
        nSendBack++;
        pendingSeqs.push(pool.returnToStash(Auth3009(tin, v, 0, vm.getBlockTimestamp() + 1 hours, sv, r, s), fee, npk, "", ""));
    }

    /// Fees leave only to the router; counters stay exact.
    function sweep() external {
        pool.sweepFees();
    }

    function _takePending(uint256 i) internal returns (uint256 seq) {
        uint256 k = i % pendingSeqs.length;
        seq = pendingSeqs[k];
        pendingSeqs[k] = pendingSeqs[pendingSeqs.length - 1];
        pendingSeqs.pop();
    }
}

contract ConservationInvariant is Base {
    Handler handler;

    function setUp() public override {
        super.setUp();
        address op = makeAddr("operator");
        vm.prank(owner);
        pool.setOperator(op, true);
        address sink = address(new FeeSink());
        vm.prank(owner);
        pool.setFeeRouter(sink);
        mockBonds.set(op, true);
        handler = new Handler(pool, usdg, alice, aliceKey, op);
        targetContract(address(handler));
    }

    function afterInvariant() public view {
        console.log("req exec cancel", handler.nReq(), handler.nExec(), handler.nCancel());
        console.log("self sendBack withdraw", handler.nSelf(), handler.nSendBack(), handler.nWithdraw());
    }

    /// Build §3.1 / §12: balance covers in − out, exactly.
    function invariant_balanceMatchesCounters() public view {
        assertEq(usdg.balanceOf(address(pool)), pool.totalIn() - pool.totalOut());
    }

    /// Every unit held is accounted: pending entries + reserved tin sizes + fees + notes.
    function invariant_everyUnitAccounted() public view {
        assertEq(
            pool.totalIn() - pool.totalOut(),
            pool.pendingTotal() + pool.reservedTotal() + pool.feesAccrued() + handler.ghostShielded()
        );
    }
}

/// Any contract can stand in for the FeeRouter here (setFeeRouter needs code).
contract FeeSink {}
