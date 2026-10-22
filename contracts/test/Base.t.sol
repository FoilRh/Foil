// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {StashPool, Verifiers, IOperatorBonds} from "../src/StashPool.sol";
import {ScreeningGate} from "../src/ScreeningGate.sol";
import {IUSDG, Auth3009} from "../src/interfaces/IUSDG.sol";
import {IJoinsplitVerifier, IPpoiVerifier, ITinRequestVerifier, Proof} from "../src/interfaces/IVerifiers.sol";
import {MockUSDG} from "./mocks/MockUSDG.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";
import {MockBonds} from "./mocks/MockBonds.sol";
import {DeployHashers} from "./utils/DeployHashers.sol";
import {Hashers} from "../src/interfaces/IPoseidon.sol";

/// Exposes tin funding so M2 send-back tests run before rounds exist.
contract StashPoolHarness is StashPool {
    constructor(IUSDG u, ScreeningGate g, Verifiers memory v, Hashers memory h, address o, address gd)
        StashPool(u, g, v, h, o, gd)
    {}

    function fundTinForTest(address tin, uint256 amount) external {
        tinFunded[tin] += amount;
    }
}

abstract contract Base is Test {
    uint256 internal constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    MockUSDG internal usdg;
    ScreeningGate internal gate;
    MockVerifier internal verifier;
    StashPoolHarness internal pool;
    MockBonds internal mockBonds;

    address internal owner = makeAddr("timelock");
    address internal guardian = makeAddr("guardian");
    address internal alice;
    uint256 internal aliceKey;
    address internal provider1;
    uint256 internal provider1Key;
    address internal provider2;
    uint256 internal provider2Key;

    function setUp() public virtual {
        (alice, aliceKey) = makeAddrAndKey("alice");
        (provider1, provider1Key) = makeAddrAndKey("ppoi-1");
        (provider2, provider2Key) = makeAddrAndKey("ppoi-2");
        usdg = new MockUSDG();
        gate = new ScreeningGate(owner);
        verifier = new MockVerifier();
        address m = address(verifier);
        pool = new StashPoolHarness(
            IUSDG(address(usdg)),
            gate,
            Verifiers(IJoinsplitVerifier(m), ITinRequestVerifier(m), IPpoiVerifier(m)),
            DeployHashers.deploy(),
            owner,
            guardian
        );
        mockBonds = new MockBonds();
        vm.startPrank(owner);
        pool.setBonds(IOperatorBonds(address(mockBonds)));
        gate.setProvider(provider1, true);
        gate.setProvider(provider2, true);
        gate.setCleanInbound(address(pool), true);
        vm.stopPrank();
        vm.prank(provider1);
        gate.updateRoot(111);
        vm.prank(provider2);
        gate.updateRoot(222);
        usdg.mint(alice, 1_000_000e6);
        vm.prank(alice);
        usdg.approve(address(pool), type(uint256).max);
    }

    function _deposit(address from, uint256 amount, uint256 npk) internal returns (uint256 seq) {
        vm.prank(from);
        seq = pool.deposit(amount, npk, hex"c7", hex"e9");
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _providerSigs(bytes32 digest) internal view returns (bytes[] memory sigs) {
        bytes32 h = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        sigs = new bytes[](2);
        sigs[0] = _sign(provider1Key, h);
        sigs[1] = _sign(provider2Key, h);
    }

    function _auth3009(uint256 key, address from, uint256 value, bytes32 nonce) internal view returns (Auth3009 memory a) {
        bytes32 structHash = keccak256(
            abi.encode(usdg.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), from, address(pool), value, 0, block.timestamp + 1 hours, nonce)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdg.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        a = Auth3009({from: from, value: value, validAfter: 0, validBefore: block.timestamp + 1 hours, v: v, r: r, s: s});
    }

    function _proof() internal pure returns (Proof memory p) {}
}
