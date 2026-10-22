// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Base} from "./Base.t.sol";
import {StashPool} from "../src/StashPool.sol";
import {ITinRequestVerifier, Proof} from "../src/interfaces/IVerifiers.sol";

abstract contract RoundsBase is Base {
    address internal operator = makeAddr("operator");
    uint256 internal nonceCounter = 1000;

    struct Req {
        address tin;
        bytes32 salt;
        bytes32 secret;
        uint256 size;
        uint256 idx;
    }

    function setUp() public virtual override {
        super.setUp();
        // Fund the pool's shielded side (the mock verifier stands in for real notes).
        uint256 seq = _deposit(alice, 100_000e6, 1);
        skip(15 minutes);
        pool.admitAfterStandby(seq);
        vm.prank(owner);
        pool.setOperator(operator, true);
        mockBonds.set(operator, true);
        vm.deal(operator, 10 ether);
        // Start at a known time: 12:00:30 UTC on some day.
        vm.warp(1_800_000_000 - (1_800_000_000 % 600) + 30);
    }

    function _args(uint256 size, address tin, bytes32 salt, bytes32 secret) internal returns (StashPool.TinRequestArgs memory a) {
        a.root = pool.lastRoot();
        a.nullifiers = [nonceCounter++, nonceCounter++];
        a.changeCommitment = nonceCounter++;
        a.size = size;
        a.fee = 250_000;
        a.roundId = pool.currentRound();
        a.tinCommit = pool.tinCommitOf(tin, salt, size, a.roundId);
        a.refundCommit = nonceCounter++;
        a.cancelHash = uint256(keccak256(abi.encode(secret))) % FIELD;
        a.relayer = makeAddr("relayer");
        a.encryptedChange = hex"cc";
    }

    function _request(uint256 size) internal returns (Req memory r) {
        r.tin = address(uint160(uint256(keccak256(abi.encode("tin", nonceCounter)))));
        r.salt = keccak256(abi.encode("salt", nonceCounter));
        r.secret = keccak256(abi.encode("secret", nonceCounter));
        r.size = size;
        StashPool.TinRequestArgs memory a = _args(size, r.tin, r.salt, r.secret);
        r.idx = pool.requestTin(_proof(), a);
    }

    function _sorted(Req[] memory rs) internal pure returns (address[] memory tins, bytes32[] memory salts) {
        for (uint256 i = 0; i < rs.length; i++) {
            for (uint256 j = i + 1; j < rs.length; j++) {
                if (rs[j].tin < rs[i].tin) (rs[i], rs[j]) = (rs[j], rs[i]);
            }
        }
        tins = new address[](rs.length);
        salts = new bytes32[](rs.length);
        for (uint256 i = 0; i < rs.length; i++) (tins[i], salts[i]) = (rs[i].tin, rs[i].salt);
    }

    function _fullRound(uint256 n) internal returns (uint256 roundId, Req[] memory rs) {
        roundId = pool.currentRound();
        rs = new Req[](n);
        for (uint256 i = 0; i < n; i++) rs[i] = _request(25e6);
        vm.warp(block.timestamp - (block.timestamp % 600) + 600); // next boundary
        pool.closeRound();
    }

    function _execute(uint256 roundId, address[] memory tins, bytes32[] memory salts) internal {
        uint256 v = pool.ethPerTin() * tins.length;
        vm.prank(operator);
        pool.executeRound{value: v}(roundId, tins, salts);
    }

}

contract RoundsTest is RoundsBase {
    // ---------------------------------------------------------------- requests

    function test_requestReservesSizePlusFeesAndPassesBoundInputs() public {
        StashPool.TinRequestArgs memory a = _args(25e6, address(1), bytes32(uint256(2)), bytes32(uint256(3)));
        uint256 reserved = 25e6 + 37_500 + 200_000 + 1e6;
        assertEq(pool.reservedFor(25e6), reserved);
        uint256[13] memory pub = [
            a.root, pool.tinRequestDataHash(a.relayer, a.encryptedChange), uint256(uint160(address(usdg))), pool.POOL_ID(),
            a.nullifiers[0], a.nullifiers[1], a.changeCommitment, reserved, a.fee, a.roundId, a.tinCommit,
            a.refundCommit, a.cancelHash
        ];
        Proof memory p;
        vm.expectCall(address(verifier), abi.encodeCall(ITinRequestVerifier.verifyProof, (p.a, p.b, p.c, pub)));
        pool.requestTin(p, a);
        assertEq(pool.reservedTotal(), reserved);
        assertEq(usdg.balanceOf(a.relayer), 250_000);
        StashPool.Request memory q = pool.getRequest(a.roundId, 0);
        assertEq(uint8(q.state), uint8(StashPool.RequestState.Pending));
    }

    function test_requestRejections() public {
        StashPool.TinRequestArgs memory a = _args(30e6, address(1), 0, 0);
        vm.expectRevert(StashPool.BadSize.selector);
        pool.requestTin(_proof(), a);

        a = _args(25e6, address(1), 0, 0);
        a.roundId = 7;
        vm.expectRevert(StashPool.BadRound.selector);
        pool.requestTin(_proof(), a);

        a = _args(25e6, address(1), 0, 0);
        pool.requestTin(_proof(), a);
        StashPool.TinRequestArgs memory again = _args(25e6, address(1), 0, 0);
        vm.expectRevert(StashPool.CommitUsed.selector);
        pool.requestTin(_proof(), again);

        vm.prank(guardian);
        pool.pause(false, true);
        StashPool.TinRequestArgs memory paused = _args(25e6, address(2), 0, 0);
        vm.expectRevert(StashPool.RequestsPaused.selector);
        pool.requestTin(_proof(), paused);
    }

    // ---------------------------------------------------------------- closing

    function test_closesAtBoundaryWithEight() public {
        for (uint256 i = 0; i < 8; i++) _request(25e6);
        vm.expectRevert(StashPool.CannotClose.selector);
        pool.closeRound(); // 12:00:30, not a boundary yet
        vm.warp(block.timestamp + 570); // 12:10:00
        pool.closeRound();
        assertEq(pool.currentRound(), 2);
    }

    function test_rollsForwardBelowEightThenClosesAt30Min() public {
        uint256 first = vm.getBlockTimestamp(); // via_ir would re-read block.timestamp after warp
        for (uint256 i = 0; i < 7; i++) _request(25e6);
        vm.warp(first + 570);
        assertFalse(pool.canClose(1));
        vm.warp(first + 30 minutes - 1);
        assertFalse(pool.canClose(1));
        vm.warp(first + 30 minutes);
        pool.closeRound();
    }

    function test_noCloseOutsideTheWindow() public {
        for (uint256 i = 0; i < 9; i++) _request(25e6);
        vm.warp(block.timestamp - (block.timestamp % 600) + 600 + 3 minutes); // 3 min past a boundary
        assertFalse(pool.canClose(1));
    }

    function test_emptyRoundCannotClose() public {
        skip(2 hours);
        vm.expectRevert(StashPool.CannotClose.selector);
        pool.closeRound();
    }

    // ---------------------------------------------------------------- execution

    function test_executePaysUsdgAndEthInOneTx() public {
        (uint256 id, Req[] memory rs) = _fullRound(8);
        (address[] memory tins, bytes32[] memory salts) = _sorted(rs);
        uint256 opBefore = usdg.balanceOf(operator);
        _execute(id, tins, salts);
        for (uint256 i = 0; i < tins.length; i++) {
            assertEq(usdg.balanceOf(tins[i]), 25e6);
            assertEq(tins[i].balance, pool.ethPerTin());
            assertEq(pool.tinFunded(tins[i]), 25e6);
        }
        assertEq(usdg.balanceOf(operator) - opBefore, 8 * 1e6, "gas reimbursed in USDG");
        assertEq(pool.reservedTotal(), 0);
    }

    function test_executeRejectsMismatchUnsortedAndWrongValue() public {
        (uint256 id, Req[] memory rs) = _fullRound(8);
        (address[] memory tins, bytes32[] memory salts) = _sorted(rs);

        bytes32 good = salts[3];
        salts[3] = bytes32(uint256(good) ^ 1);
        uint256 v = pool.ethPerTin() * 8;
        vm.prank(operator);
        vm.expectRevert(StashPool.BadReveal.selector);
        pool.executeRound{value: v}(id, tins, salts);
        salts[3] = good;

        (tins[0], tins[1]) = (tins[1], tins[0]);
        (salts[0], salts[1]) = (salts[1], salts[0]);
        vm.prank(operator);
        vm.expectRevert(StashPool.NotSorted.selector);
        pool.executeRound{value: v}(id, tins, salts);
        (tins[0], tins[1]) = (tins[1], tins[0]);
        (salts[0], salts[1]) = (salts[1], salts[0]);

        vm.prank(operator);
        vm.expectRevert(StashPool.BadValue.selector);
        pool.executeRound{value: v - 1}(id, tins, salts);

        vm.expectRevert(StashPool.NotOperator.selector);
        pool.executeRound{value: v}(id, tins, salts);
    }

    function test_repeatedRevealIsSkippedNotDoubleFunded() public {
        (uint256 id, Req[] memory rs) = _fullRound(8);
        address[] memory tins = new address[](2);
        bytes32[] memory salts = new bytes32[](2);
        (tins[0], salts[0]) = (rs[0].tin, rs[0].salt);
        (tins[1], salts[1]) = (rs[0].tin, rs[0].salt);
        uint256 ethBefore = operator.balance;
        _execute(id, tins, salts);
        assertEq(usdg.balanceOf(rs[0].tin), 25e6);
        assertEq(operator.balance, ethBefore - pool.ethPerTin(), "second reveal's ETH returned");
    }

    function test_twoRequestsForOneTinBothFund() public {
        address tin = makeAddr("sameTin");
        bytes32 salt = keccak256("s");
        pool.requestTin(_proof(), _args(10e6, tin, salt, keccak256("a")));
        pool.requestTin(_proof(), _args(25e6, tin, salt, keccak256("b")));
        for (uint256 i = 0; i < 6; i++) _request(25e6);
        vm.warp(block.timestamp - (block.timestamp % 600) + 600);
        pool.closeRound();
        address[] memory tins = new address[](2);
        bytes32[] memory salts = new bytes32[](2);
        (tins[0], salts[0], tins[1], salts[1]) = (tin, salt, tin, salt);
        _execute(1, tins, salts);
        assertEq(usdg.balanceOf(tin), 35e6);
    }

    function test_cancelledSmallerCommitCannotHideTheRealRequest() public {
        address tin = makeAddr("victimTin");
        bytes32 salt = keccak256("s");
        uint256 small = pool.requestTin(_proof(), _args(10e6, tin, salt, keccak256("a")));
        pool.requestTin(_proof(), _args(25e6, tin, salt, keccak256("b")));
        for (uint256 i = 0; i < 6; i++) _request(25e6);
        pool.cancelRequest(1, small, keccak256("a"));
        vm.warp(block.timestamp - (block.timestamp % 600) + 600);
        pool.closeRound();
        address[] memory tins = new address[](1);
        bytes32[] memory salts = new bytes32[](1);
        (tins[0], salts[0]) = (tin, salt);
        _execute(1, tins, salts);
        assertEq(usdg.balanceOf(tin), 25e6);
    }

    function test_emptyOrAllSkippedExecutionCannotLatchTheRound() public {
        (uint256 id, Req[] memory rs) = _fullRound(8);
        address[] memory none = new address[](0);
        vm.prank(operator);
        vm.expectRevert(StashPool.NothingExecuted.selector);
        pool.executeRound(id, none, new bytes32[](0));
        // Partial execution, then a second call finishes the round.
        Req[] memory half = new Req[](4);
        for (uint256 i = 0; i < 4; i++) half[i] = rs[i];
        (address[] memory t1, bytes32[] memory s1) = _sorted(half);
        _execute(id, t1, s1);
        Req[] memory rest = new Req[](4);
        for (uint256 i = 0; i < 4; i++) rest[i] = rs[i + 4];
        (address[] memory t2, bytes32[] memory s2) = _sorted(rest);
        _execute(id, t2, s2);
        assertEq(pool.reservedTotal(), 0);
        assertEq(pool.roundExecutor(id), operator);
    }

    function test_tinThatRefusesEthOrUsdgCannotBlockTheRound() public {
        address noEth = address(new NoReceive());
        bytes32 salt = keccak256("x");
        pool.requestTin(_proof(), _args(25e6, noEth, salt, keccak256("a")));
        uint256 poolReq = pool.requestTin(_proof(), _args(25e6, address(pool), salt, keccak256("b")));
        for (uint256 i = 0; i < 6; i++) _request(25e6);
        vm.warp(block.timestamp - (block.timestamp % 600) + 600);
        pool.closeRound();
        address[] memory tins = new address[](2);
        bytes32[] memory salts = new bytes32[](2);
        (tins[0], tins[1]) = noEth < address(pool) ? (noEth, address(pool)) : (address(pool), noEth);
        (salts[0], salts[1]) = (salt, salt);
        uint256 ethBefore = operator.balance;
        _execute(1, tins, salts);
        assertEq(usdg.balanceOf(noEth), 25e6, "USDG paid even though ETH was refused");
        assertEq(operator.balance, ethBefore, "both tins' ETH returned");
        assertEq(uint8(pool.getRequest(1, poolReq).state), uint8(StashPool.RequestState.Unfundable));
        pool.cancelRequest(1, poolReq, keccak256("b")); // the requester gets the refund note
    }

    function test_unbondedOperatorCannotExecute() public {
        (uint256 id, Req[] memory rs) = _fullRound(8);
        (address[] memory tins, bytes32[] memory salts) = _sorted(rs);
        mockBonds.set(operator, false);
        uint256 v = pool.ethPerTin() * 8;
        vm.prank(operator);
        vm.expectRevert(StashPool.NotOperator.selector);
        pool.executeRound{value: v}(id, tins, salts);
    }

    function test_relayerFeeLegIsCapped() public {
        StashPool.TinRequestArgs memory a = _args(25e6, address(1), 0, 0);
        a.fee = pool.MAX_RELAYER_FEE() + 1;
        vm.expectRevert(StashPool.BadExtData.selector);
        pool.requestTin(_proof(), a);
    }

    function test_revealFromAnotherRoundIsRejected() public {
        (uint256 id1, Req[] memory r1) = _fullRound(8);
        (uint256 id2,) = _fullRound(8);
        address[] memory tins = new address[](1);
        bytes32[] memory salts = new bytes32[](1);
        (tins[0], salts[0]) = (r1[0].tin, r1[0].salt);
        uint256 v = pool.ethPerTin();
        vm.prank(operator);
        vm.expectRevert(StashPool.BadReveal.selector);
        pool.executeRound{value: v}(id2, tins, salts);
        assertTrue(id1 != id2);
    }

    // ---------------------------------------------------------------- settle-once races

    function test_cancelThenExecuteSkipsAndRefundsEth() public {
        (uint256 id, Req[] memory rs) = _fullRound(8);
        pool.cancelRequest(id, rs[2].idx, rs[2].secret);
        address cancelledTin = rs[2].tin; // _sorted reorders rs in place
        (address[] memory tins, bytes32[] memory salts) = _sorted(rs);
        uint256 ethBefore = operator.balance;
        _execute(id, tins, salts);
        assertEq(operator.balance, ethBefore - 7 * pool.ethPerTin(), "skipped tin's ETH returned");
        assertEq(usdg.balanceOf(cancelledTin), 0);
    }

    function test_executeThenCancelOrSelfExecuteReverts() public {
        (uint256 id, Req[] memory rs) = _fullRound(8);
        (address[] memory tins, bytes32[] memory salts) = _sorted(rs);
        _execute(id, tins, salts);
        vm.expectRevert(StashPool.NotSettleable.selector);
        pool.cancelRequest(id, rs[0].idx, rs[0].secret);
        skip(2 hours);
        vm.expectRevert(StashPool.NotSettleable.selector);
        pool.selfExecute(id, rs[0].idx, rs[0].tin, rs[0].salt);
    }

    function test_cancelPaysOnlyRefundCommitAndNeedsSecret() public {
        (uint256 id, Req[] memory rs) = _fullRound(8);
        vm.expectRevert(StashPool.BadSecret.selector);
        pool.cancelRequest(id, rs[0].idx, bytes32(uint256(rs[0].secret) ^ 1));
        uint32 before = pool.nextIndex();
        uint256 balBefore = usdg.balanceOf(address(pool));
        pool.cancelRequest(id, rs[0].idx, rs[0].secret);
        assertEq(pool.nextIndex(), before + 1, "refund is one leaf: refundCommit");
        assertEq(usdg.balanceOf(address(pool)), balBefore, "no USDG leaves the pool");
        vm.expectRevert(StashPool.NotSettleable.selector);
        pool.cancelRequest(id, rs[0].idx, rs[0].secret);
    }

    function test_selfExecuteAfter60MinWithZeroValue() public {
        (uint256 id, Req[] memory rs) = _fullRound(8);
        skip(59 minutes);
        vm.expectRevert(StashPool.TooEarly.selector);
        pool.selfExecute(id, rs[0].idx, rs[0].tin, rs[0].salt);
        skip(1 minutes);
        address relayer = makeAddr("anyRelayer");
        vm.prank(relayer);
        pool.selfExecute(id, rs[0].idx, rs[0].tin, rs[0].salt);
        assertEq(usdg.balanceOf(rs[0].tin), 26e6, "size plus the unused gas fee");
        assertEq(usdg.balanceOf(relayer), 0, "the caller earns nothing");
        address tin0 = rs[0].tin;

        // The operator's late execution skips it.
        (address[] memory tins, bytes32[] memory salts) = _sorted(rs);
        _execute(id, tins, salts);
        assertEq(usdg.balanceOf(tin0), 26e6);
    }

    function test_omittedRequestStaysPendingForSelfExecute() public {
        (uint256 id, Req[] memory rs) = _fullRound(8);
        Req[] memory some = new Req[](7);
        for (uint256 i = 0; i < 7; i++) some[i] = rs[i + 1];
        (address[] memory tins, bytes32[] memory salts) = _sorted(some);
        _execute(id, tins, salts);
        assertEq(uint8(pool.getRequest(id, rs[0].idx).state), uint8(StashPool.RequestState.Pending));
        skip(1 hours);
        pool.selfExecute(id, rs[0].idx, rs[0].tin, rs[0].salt);
    }

    function test_exitsWorkWhileRequestsPaused() public {
        (uint256 id, Req[] memory rs) = _fullRound(8);
        vm.prank(guardian);
        pool.pause(true, true);
        pool.cancelRequest(id, rs[0].idx, rs[0].secret);
        skip(1 hours);
        pool.selfExecute(id, rs[1].idx, rs[1].tin, rs[1].salt);
    }

    function test_paramsAreBounded() public {
        vm.startPrank(owner);
        vm.expectRevert(StashPool.OutOfBounds.selector);
        pool.setParams(6e6, 0.0004 ether);
        vm.expectRevert(StashPool.OutOfBounds.selector);
        pool.setParams(1e6, 0.006 ether);
        pool.setParams(2e6, 0.001 ether);
        vm.stopPrank();
    }
}

contract NoReceive {}
