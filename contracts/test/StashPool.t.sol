// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Base} from "./Base.t.sol";
import {StashPool} from "../src/StashPool.sol";
import {ScreeningGate} from "../src/ScreeningGate.sol";
import {IJoinsplitVerifier, IPpoiVerifier, Proof} from "../src/interfaces/IVerifiers.sol";
import {Auth3009} from "../src/interfaces/IUSDG.sol";

contract EntryQueueTest is Base {
    uint256 constant NPK = 12345;

    function test_depositIsPendingWithNoLeaf() public {
        uint256 seq = _deposit(alice, 30e6, NPK);
        (address origin,, StashPool.EntryState state,, uint256 gross, uint256 fee,) = pool.entries(seq);
        assertEq(origin, alice);
        assertEq(uint8(state), uint8(StashPool.EntryState.Pending));
        assertEq(gross, 30e6);
        assertEq(fee, 45_000); // 0.15%
        assertEq(pool.nextIndex(), 0, "pending entries have no leaf");
        assertEq(pool.pendingTotal(), 30e6);
    }

    function test_admitAfterStandby_insertsOnChainCommitment() public {
        uint256 seq = _deposit(alice, 30e6, NPK);
        vm.expectRevert(StashPool.StandbyActive.selector);
        pool.admitAfterStandby(seq);
        skip(15 minutes);
        pool.admitAfterStandby(seq);
        uint256 expected = pool.poseidonT4().hash([uint256(uint160(address(usdg))), 30e6 - 45_000, NPK]);
        assertEq(pool.nextIndex(), 1);
        assertEq(pool.lastRoot(), _rootOfOne(expected));
        assertEq(pool.feesAccrued(), 45_000);
        assertEq(pool.pendingTotal(), 0);
    }

    function test_standbyIs60MinWithFewerThanTwoFreshProviders() public {
        skip(3 hours); // both provider roots go stale
        uint256 seq = _deposit(alice, 30e6, NPK);
        skip(15 minutes);
        vm.expectRevert(StashPool.StandbyActive.selector);
        pool.admitAfterStandby(seq);
        skip(45 minutes);
        pool.admitAfterStandby(seq);
    }

    function test_admitWithTwoProviderSignatures() public {
        uint256 seq = _deposit(alice, 30e6, NPK);
        pool.admitWithSignatures(seq, _providerSigs(pool.admitDigest(seq)));
        assertEq(pool.nextIndex(), 1);
    }

    function test_admitRejectsOneOrDuplicateSignatures() public {
        uint256 seq = _deposit(alice, 30e6, NPK);
        bytes[] memory two = _providerSigs(pool.admitDigest(seq));
        bytes[] memory dup = new bytes[](2);
        dup[0] = two[0];
        dup[1] = two[0];
        vm.expectRevert(ScreeningGate.NotEnoughSignatures.selector);
        pool.admitWithSignatures(seq, dup);
        bytes[] memory one = new bytes[](1);
        one[0] = two[1];
        vm.expectRevert(ScreeningGate.NotEnoughSignatures.selector);
        pool.admitWithSignatures(seq, one);
    }

    function test_admitWithProofs_checksEveryFreshProviderRoot() public {
        uint256 seq = _deposit(alice, 30e6, NPK);
        uint256 originHash = pool.poseidonT3().hash([uint256(uint160(alice)), 0]);
        Proof[] memory proofs = new Proof[](2);
        vm.expectCall(address(verifier), abi.encodeWithSignature("verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[2])", proofs[0].a, proofs[0].b, proofs[0].c, [uint256(111), originHash]));
        vm.expectCall(address(verifier), abi.encodeWithSignature("verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[2])", proofs[1].a, proofs[1].b, proofs[1].c, [uint256(222), originHash]));
        pool.admitWithProofs(seq, proofs);
        assertEq(pool.nextIndex(), 1);
    }

    function test_admitWithProofs_needsTwoFreshProviders() public {
        uint256 seq = _deposit(alice, 30e6, NPK);
        skip(3 hours);
        vm.expectRevert(StashPool.NotEnoughProviders.selector);
        pool.admitWithProofs(seq, new Proof[](0));
    }

    function test_flaggedNeverEntersAndExitsOnceToOrigin() public {
        uint256 seq = _deposit(alice, 30e6, NPK);
        vm.prank(provider1);
        pool.flag(seq);
        skip(1 days);
        vm.expectRevert(StashPool.BadEntryState.selector);
        pool.admitAfterStandby(seq);

        uint256 before = usdg.balanceOf(alice);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(aliceKey, pool.exitDigest(seq, deadline));
        vm.prank(makeAddr("anyone")); // a relayer may submit it
        pool.exitPending(seq, deadline, sig);
        assertEq(usdg.balanceOf(alice) - before, 30e6, "full refund, no fee");
        assertEq(pool.nextIndex(), 0);

        vm.expectRevert(StashPool.BadEntryState.selector);
        pool.exitPending(seq, deadline, sig);
    }

    function test_exitPendingNeedsOriginSignature() public {
        uint256 seq = _deposit(alice, 30e6, NPK);
        (, uint256 mallory) = makeAddrAndKey("mallory");
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(mallory, pool.exitDigest(seq, deadline));
        vm.expectRevert(StashPool.BadSignature.selector);
        pool.exitPending(seq, deadline, sig);
    }

    function test_onlyProvidersFlag() public {
        uint256 seq = _deposit(alice, 30e6, NPK);
        vm.expectRevert(ScreeningGate.NotProvider.selector);
        pool.flag(seq);
    }

    function test_guardianPausesDepositsButNotExits() public {
        uint256 seq = _deposit(alice, 30e6, NPK);
        vm.prank(guardian);
        pool.pause(true, true);
        vm.expectRevert(StashPool.DepositsPaused.selector);
        _deposit(alice, 30e6, NPK);

        uint256 deadline = block.timestamp + 1 hours;
        pool.exitPending(seq, deadline, _sign(aliceKey, pool.exitDigest(seq, deadline)));

        vm.prank(guardian);
        pool.pause(false, false); // the guardian cannot unpause
        assertTrue(pool.depositsPaused());
        vm.prank(owner);
        pool.pause(false, false);
        assertFalse(pool.depositsPaused());
    }

    function test_canaryCapsBoundDepositsNotExits() public {
        vm.expectRevert();
        pool.setCaps(1_000e6, 1_500e6); // owner only
        vm.prank(owner);
        pool.setCaps(1_000e6, 1_500e6);

        vm.expectRevert(StashPool.OverCap.selector);
        _deposit(alice, 1_001e6, NPK); // over the per-deposit cap
        uint256 seq = _deposit(alice, 1_000e6, NPK);
        vm.expectRevert(StashPool.OverCap.selector);
        _deposit(alice, 501e6, NPK); // the pool would hold 1,501
        _deposit(alice, 500e6, NPK);

        // Exits stay open at the cap.
        uint256 deadline = block.timestamp + 1 hours;
        pool.exitPending(seq, deadline, _sign(aliceKey, pool.exitDigest(seq, deadline)));
        _deposit(alice, 1_000e6, NPK); // room again after the exit

        vm.prank(owner);
        pool.setCaps(0, 0); // lifted after the canary
        _deposit(alice, 50_000e6, NPK);
    }

    function testFuzz_depositFeeAndCounters(uint96 amount) public {
        uint256 a = bound(amount, pool.MIN_DEPOSIT(), 1_000_000e6);
        uint256 seq = _deposit(alice, a, NPK);
        skip(15 minutes);
        pool.admitAfterStandby(seq);
        assertEq(pool.feesAccrued(), (a * 15 + 9_999) / 10_000);
        assertEq(usdg.balanceOf(address(pool)), pool.totalIn() - pool.totalOut());
    }

    function _rootOfOne(uint256 leaf) internal view returns (uint256 cur) {
        cur = leaf;
        for (uint256 i = 0; i < pool.LEVELS(); i++) cur = pool.poseidonT3().hash([cur, pool.zeros(i)]);
    }
}

contract TransactTest is Base {
    function setUp() public override {
        super.setUp();
        uint256 seq = _deposit(alice, 100e6, 1);
        skip(15 minutes);
        pool.admitAfterStandby(seq);
    }

    function _ext(address recipient, int256 extAmount, address relayer, uint256 fee) internal pure returns (StashPool.ExtData memory) {
        return StashPool.ExtData(recipient, extAmount, relayer, fee, hex"01", hex"02");
    }

    function test_withdrawPaysRecipientMinusFeeAndRelayer() public {
        address bob = makeAddr("bob");
        address relayer = makeAddr("relayer");
        StashPool.ExtData memory ext = _ext(bob, -10e6, relayer, 250_000);
        uint256 root = pool.lastRoot();
        uint256[9] memory pub = [
            root, FIELD - (10e6 + 250_000), pool.extDataHash(ext), uint256(uint160(address(usdg))), pool.POOL_ID(),
            uint256(11), uint256(12), uint256(21), uint256(22)
        ];
        Proof memory p;
        vm.expectCall(address(verifier), abi.encodeCall(IJoinsplitVerifier.verifyProof, (p.a, p.b, p.c, pub)));
        pool.transact(p, root, [uint256(11), 12], [uint256(21), 22], ext);
        assertEq(usdg.balanceOf(bob), 10e6 - 25_000, "0.25% withdrawal fee");
        assertEq(usdg.balanceOf(relayer), 250_000);
        assertEq(pool.nextIndex(), 3, "two output leaves");
        assertTrue(pool.nullifierSpent(11) && pool.nullifierSpent(12));
    }

    function test_rejectsSpentNullifierUnknownRootAndBadProof() public {
        uint256 root = pool.lastRoot();
        StashPool.ExtData memory ext = _ext(address(0), 0, address(0), 0);
        pool.transact(_proof(), root, [uint256(1), 2], [uint256(3), 4], ext);
        root = pool.lastRoot();
        vm.expectRevert(StashPool.NullifierSpent.selector);
        pool.transact(_proof(), root, [uint256(2), 5], [uint256(3), 4], ext);
        vm.expectRevert(StashPool.UnknownRoot.selector);
        pool.transact(_proof(), 999, [uint256(6), 7], [uint256(3), 4], ext);
        verifier.setAccept(false);
        vm.expectRevert(StashPool.InvalidProof.selector);
        pool.transact(_proof(), root, [uint256(8), 9], [uint256(3), 4], ext);
    }

    function test_rejectsDepositsThroughTransact() public {
        StashPool.ExtData memory ext = _ext(alice, 1, address(0), 0);
        uint256 root = pool.lastRoot();
        vm.expectRevert(StashPool.BadExtData.selector);
        pool.transact(_proof(), root, [uint256(1), 2], [uint256(3), 4], ext);
    }

    function test_conservationBlocksOverWithdrawal() public {
        // A (mock-)valid proof cannot take more than the pool holds against its counters.
        StashPool.ExtData memory ext = _ext(alice, -200e6, address(0), 0);
        uint256 root = pool.lastRoot();
        vm.expectRevert();
        pool.transact(_proof(), root, [uint256(1), 2], [uint256(3), 4], ext);
    }

    function test_withdrawWorksWhilePaused() public {
        vm.prank(guardian);
        pool.pause(true, true);
        pool.transact(_proof(), pool.lastRoot(), [uint256(1), 2], [uint256(3), 4], _ext(alice, -1e6, address(0), 0));
    }
}

contract SendBackTest is Base {
    address tin;
    uint256 tinKey;

    function setUp() public override {
        super.setUp();
        (tin, tinKey) = makeAddrAndKey("tin");
        pool.fundTinForTest(tin, 25e6);
        usdg.mint(tin, 100e6);
    }

    function _sendBack(uint256 value, uint256 npk) internal returns (uint256) {
        return _sendBack(value, 0, npk);
    }

    function _sendBack(uint256 value, uint256 fee, uint256 npk) internal returns (uint256) {
        return pool.returnToStash(_authFor(value, fee, npk), fee, npk, hex"aa", hex"bb");
    }

    function _authFor(uint256 value, uint256 npk) internal view returns (Auth3009 memory) {
        return _authFor(value, 0, npk);
    }

    function _authFor(uint256 value, uint256 fee, uint256 npk) internal view returns (Auth3009 memory) {
        return _auth3009(tinKey, tin, value, pool.sendBackNonce(npk, fee, hex"aa", hex"bb"));
    }

    function test_freeWithinFundedAmount_feeAbove() public {
        uint256 s1 = _sendBack(20e6, 1);
        (,,,,, uint256 fee1,) = pool.entries(s1);
        assertEq(fee1, 0);
        uint256 s2 = _sendBack(10e6, 12_500, 2); // 5 free left, 5 above
        (,,,,, uint256 fee2,) = pool.entries(s2);
        assertEq(fee2, 12_500);
    }

    function test_cleanInboundAdmitsImmediately() public {
        uint256 seq = _sendBack(20e6, 1);
        pool.admitWithSignatures(seq, _providerSigs(pool.admitDigest(seq)));
        assertEq(pool.nextIndex(), 1);
    }

    function test_relayerCannotRedirectTheNote() public {
        bytes32 nonce = pool.sendBackNonce(1, 0, hex"aa", hex"bb");
        Auth3009 memory a = _auth3009(tinKey, tin, 20e6, nonce);
        vm.expectRevert("invalid signature");
        pool.returnToStash(a, 0, 999, hex"aa", hex"bb"); // swapped npk changes the nonce
    }

    function test_noDirectReplayToUsdg() public {
        bytes32 nonce = pool.sendBackNonce(1, 0, hex"aa", hex"bb");
        Auth3009 memory a = _auth3009(tinKey, tin, 20e6, nonce);
        vm.expectRevert("caller must be the payee");
        usdg.receiveWithAuthorization(tin, address(pool), 20e6, a.validAfter, a.validBefore, nonce, a.v, a.r, a.s);
        pool.returnToStash(a, 0, 1, hex"aa", hex"bb");
        vm.expectRevert("authorization used");
        pool.returnToStash(a, 0, 1, hex"aa", hex"bb");
    }

    function test_silentReplayCannotBurnSendBackSlots() public {
        usdg.setSilentReplay(true); // behave like RHC USDG
        Auth3009 memory a = _authFor(5e6, 1);
        pool.returnToStash(a, 0, 1, hex"aa", hex"bb");
        vm.expectRevert(StashPool.BadAmount.selector);
        pool.returnToStash(a, 0, 1, hex"aa", hex"bb");
        assertEq(pool.tinSendBacks(tin), 1);
    }

    function test_limits() public {
        Auth3009 memory small = _authFor(0.5e6, 1);
        vm.expectRevert(StashPool.BadAmount.selector);
        pool.returnToStash(small, 0, 1, hex"aa", hex"bb");
        for (uint256 i = 0; i < 10; i++) _sendBack(1e6, i + 10);
        Auth3009 memory eleventh = _authFor(1e6, 99);
        vm.expectRevert(StashPool.SendBackLimit.selector);
        pool.returnToStash(eleventh, 0, 99, hex"aa", hex"bb");
    }

    function test_onlyFundedTins() public {
        (address stranger, uint256 key) = makeAddrAndKey("stranger");
        usdg.mint(stranger, 10e6);
        bytes32 nonce = pool.sendBackNonce(1, 0, hex"aa", hex"bb");
        Auth3009 memory a = _auth3009(key, stranger, 5e6, nonce);
        vm.expectRevert(StashPool.NotATin.selector);
        pool.returnToStash(a, 0, 1, hex"aa", hex"bb");
    }

    function test_sendBacksWorkWhilePaused() public {
        vm.prank(guardian);
        pool.pause(true, true);
        _sendBack(5e6, 1);
    }

    function test_excessOverFundedFollowsDepositPause() public {
        vm.prank(guardian);
        pool.pause(true, false);
        Auth3009 memory a = _authFor(30e6, 12_500, 1); // 25 funded, 5 new money
        vm.expectRevert(StashPool.DepositsPaused.selector);
        pool.returnToStash(a, 12_500, 1, hex"aa", hex"bb");
    }

    function test_excessOverFundedFollowsCaps() public {
        vm.prank(owner);
        pool.setCaps(4e6, 0);
        Auth3009 memory a = _authFor(30e6, 12_500, 1);
        vm.expectRevert(StashPool.OverCap.selector);
        pool.returnToStash(a, 12_500, 1, hex"aa", hex"bb");
        _sendBack(25e6, 2); // the funded part is never capped
    }

    function test_feeIsBoundIntoTheAuthorization() public {
        _sendBack(20e6, 1); // 5 free left
        // Signed expecting 0 fee, but only 5 of the 10 are free now: reverts instead of
        // creating a note that differs from its ciphertext.
        Auth3009 memory a = _authFor(10e6, 0, 2);
        vm.expectRevert(StashPool.BadAmount.selector);
        pool.returnToStash(a, 0, 2, hex"aa", hex"bb");
    }
}
