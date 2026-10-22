// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {PostDeployCheck} from "../script/PostDeployCheck.s.sol";
import {StashPool, Verifiers, IOperatorBonds} from "../src/StashPool.sol";
import {ScreeningGate} from "../src/ScreeningGate.sol";
import {FOIL} from "../src/FOIL.sol";
import {FoilStaking} from "../src/FoilStaking.sol";
import {FeeRouter, IRewardNotifier} from "../src/FeeRouter.sol";
import {Bonds} from "../src/Bonds.sol";
import {JoinsplitVerifier} from "../src/verifiers/JoinsplitVerifier.sol";
import {TinRequestVerifier} from "../src/verifiers/TinRequestVerifier.sol";
import {PpoiVerifier} from "../src/verifiers/PpoiVerifier.sol";
import {IUSDG} from "../src/interfaces/IUSDG.sol";
import {IJoinsplitVerifier, ITinRequestVerifier, IPpoiVerifier} from "../src/interfaces/IVerifiers.sol";
import {Hashers} from "../src/interfaces/IPoseidon.sol";
import {MockUSDG} from "./mocks/MockUSDG.sol";
import {DeployHashers} from "./utils/DeployHashers.sol";

/// Deploys the Deploy.s.sol stack locally (Safe → timelock owner), writes a manifest, and
/// runs script/PostDeployCheck.s.sol against it, untouched and tampered.
contract PostDeployCheckTest is Test {
    address safe = makeAddr("safe");
    address guardian = makeAddr("guardian");
    address timelock;
    StashPool pool;
    ScreeningGate gate;
    FOIL foil;
    FoilStaking staking;
    FeeRouter router;
    Bonds bonds;
    MockUSDG usdg;
    Hashers h;
    PostDeployCheck checker;

    function setUp() public {
        checker = new PostDeployCheck();
        timelock = _timelock(24 hours);
    }

    function _timelock(uint256 delay) internal returns (address) {
        address[] memory s = new address[](1);
        s[0] = safe;
        return address(new TimelockController(delay, s, s, address(0)));
    }

    /// Mirrors Deploy.s.sol with real verifiers.
    function _deploy(address owner) internal {
        usdg = new MockUSDG();
        h = DeployHashers.deploy();
        gate = new ScreeningGate(address(this));
        Verifiers memory v = Verifiers(
            IJoinsplitVerifier(address(new JoinsplitVerifier())),
            ITinRequestVerifier(address(new TinRequestVerifier())),
            IPpoiVerifier(address(new PpoiVerifier()))
        );
        pool = new StashPool(IUSDG(address(usdg)), gate, v, h, address(this), guardian);
        foil = new FOIL(safe, 1_000_000_000e18);
        address routerAddr = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        staking = new FoilStaking(IERC20(address(foil)), IERC20(address(usdg)), routerAddr, owner);
        router = new FeeRouter(IERC20(address(usdg)), owner, safe, safe, IRewardNotifier(address(staking)), address(0xdEaD));
        bonds = new Bonds(IERC20(address(foil)), pool, safe, owner);
        pool.setFeeRouter(address(router));
        pool.setBonds(IOperatorBonds(address(bonds)));
        gate.setCleanInbound(address(pool), true);
        gate.transferOwnership(owner);
        pool.transferOwnership(owner);
    }

    /// Writes a manifest like Deploy.s.sol's, with `ownerKey` and `poolKey` as given.
    function _manifest(string memory name, address ownerKey, address poolKey) internal returns (string memory path) {
        string memory o = name;
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeAddress(o, "usdg", address(usdg));
        vm.serializeAddress(o, "owner", ownerKey);
        vm.serializeAddress(o, "safe", safe);
        vm.serializeAddress(o, "guardian", guardian);
        vm.serializeAddress(o, "burnSink", address(0xdEaD));
        vm.serializeAddress(o, "gate", address(gate));
        vm.serializeAddress(o, "poseidonT3", address(h.t3));
        vm.serializeAddress(o, "poseidonT4", address(h.t4));
        vm.serializeAddress(o, "foil", address(foil));
        vm.serializeAddress(o, "staking", address(staking));
        vm.serializeAddress(o, "feeRouter", address(router));
        vm.serializeAddress(o, "bonds", address(bonds));
        string memory out = vm.serializeAddress(o, "pool", poolKey);
        path = string.concat("deployments/pdc-test-", name, ".json");
        vm.writeJson(out, path);
    }

    function _run(string memory path) internal {
        try checker.check(path) {
            vm.removeFile(path);
        } catch (bytes memory err) {
            vm.removeFile(path);
            assembly {
                revert(add(err, 32), mload(err))
            }
        }
    }

    function test_passesOnFreshStack() public {
        _deploy(timelock);
        _run(_manifest("ok", timelock, address(pool)));
    }

    function test_failsOnWrongOwner() public {
        _deploy(timelock);
        address mallory = makeAddr("mallory");
        string memory path = _manifest("owner", mallory, address(pool));
        vm.expectRevert(
            bytes(string.concat("PostDeployCheck: pool.owner is ", vm.toString(timelock), ", expected ", vm.toString(mallory)))
        );
        _run(path);
    }

    function test_failsOnWrongPoolAddress() public {
        _deploy(timelock);
        string memory path = _manifest("pool", timelock, address(gate));
        vm.expectRevert(
            bytes(string.concat("PostDeployCheck: StashPool bytecode at ", vm.toString(address(gate)), " differs from the local build"))
        );
        _run(path);
    }

    function test_failsOnShortTimelockDelay() public {
        address fast = _timelock(1 hours);
        _deploy(fast);
        string memory path = _manifest("delay", fast, address(pool));
        vm.expectRevert(bytes("PostDeployCheck: timelock minDelay is 3600, expected 86400"));
        _run(path);
    }

    function test_failsOnRewiredFeeRouter() public {
        _deploy(timelock);
        FeeRouter other = new FeeRouter(IERC20(address(usdg)), timelock, safe, safe, IRewardNotifier(address(staking)), address(0xdEaD));
        vm.prank(timelock);
        pool.setFeeRouter(address(other));
        string memory path = _manifest("router", timelock, address(pool));
        vm.expectRevert(
            bytes(string.concat("PostDeployCheck: pool.feeRouter is ", vm.toString(address(other)), ", expected ", vm.toString(address(router))))
        );
        _run(path);
    }

    /// Immutables are masked (two pools with different wiring both match), but any other
    /// byte change is caught.
    function test_codeMatchesMasksOnlyImmutables() public {
        _deploy(timelock);
        string memory art = "out/StashPool.sol/StashPool.json";
        assertTrue(checker.codeMatches(address(pool), art));
        StashPool pool2 = new StashPool(IUSDG(makeAddr("otherUsdg")), gate, Verifiers(
            pool.joinsplitVerifier(), pool.tinRequestVerifier(), pool.ppoiVerifier()
        ), h, safe, safe);
        assertTrue(checker.codeMatches(address(pool2), art));

        bytes memory code = address(pool).code;
        code[100] = code[100] ^ 0x01;
        vm.etch(address(pool), code);
        assertFalse(checker.codeMatches(address(pool), art));
        assertFalse(checker.codeMatches(address(gate), art));
    }
}
