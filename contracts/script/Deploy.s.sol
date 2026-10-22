// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {StashPool, Verifiers, IOperatorBonds} from "../src/StashPool.sol";
import {ScreeningGate} from "../src/ScreeningGate.sol";
import {JoinsplitVerifier} from "../src/verifiers/JoinsplitVerifier.sol";
import {TinRequestVerifier} from "../src/verifiers/TinRequestVerifier.sol";
import {PpoiVerifier} from "../src/verifiers/PpoiVerifier.sol";
import {IUSDG} from "../src/interfaces/IUSDG.sol";
import {IJoinsplitVerifier, ITinRequestVerifier, IPpoiVerifier} from "../src/interfaces/IVerifiers.sol";
import {Hashers, IPoseidonT3, IPoseidonT4} from "../src/interfaces/IPoseidon.sol";
import {MockUSDG} from "../test/mocks/MockUSDG.sol";
import {MockVerifier} from "../test/mocks/MockVerifier.sol";
import {FOIL} from "../src/FOIL.sol";
import {FoilStaking} from "../src/FoilStaking.sol";
import {FeeRouter, IRewardNotifier} from "../src/FeeRouter.sol";
import {Bonds} from "../src/Bonds.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// Deploy runbook steps 3–5 (Build §14). Env:
///   USDG          USDG address (unset: deploy a MockUSDG, local/testnets only)
///   OWNER         final owner (default: with SAFE set, a new 24h TimelockController whose
///                 proposer and executor is the Safe; without SAFE, the deployer). Mainnet
///                 refuses a deployer-owned deploy.
///   GUARDIAN      pause-only guardian (default: deployer; mainnet requires another address)
///   OPERATOR      round operator address (optional). When the deployer holds the $FOIL
///                 supply (SAFE unset), the script also bonds 30,000 $FOIL for it.
///   PROVIDERS     comma-separated ppoi-node signer addresses (optional)
///   MOCK_VERIFIERS  true: accept-all verifiers, for local service tests only (refused on 4663)
///   SAFE          2-of-3 Safe: receives the $FOIL supply; treasury and work recipient (default: deployer)
///   BURN_SINK     buy-and-burn address for the 5% (default: 0x…dEaD; mainnet requires it)
///   MAX_DEPOSIT, MAX_TOTAL  canary caps in USDG base units (default on 4663 and 46630: $1k per
///                 deposit, $500k in the pool; 0 = none). Lifted later by the owner (timelock).
/// Writes deployments/<chainid>.json.
contract Deploy is Script {
    function run() external {
        address deployer = msg.sender;
        address safe = vm.envOr("SAFE", deployer);
        address owner = vm.envOr("OWNER", address(0));
        address guardian = vm.envOr("GUARDIAN", deployer);
        address operator = vm.envOr("OPERATOR", address(0));
        address[] memory providers = vm.envOr("PROVIDERS", ",", new address[](0));

        vm.startBroadcast();
        if (owner == address(0)) owner = safe == deployer ? deployer : _timelock(safe);
        require(block.chainid != 4663 || (owner != deployer && safe != deployer), "mainnet: set SAFE (and optionally OWNER)");
        require(block.chainid != 4663 || guardian != deployer, "mainnet: set GUARDIAN");
        require(block.chainid != 4663 || vm.envOr("BURN_SINK", address(0)) != address(0), "mainnet: set BURN_SINK");
        address usdg = vm.envOr("USDG", address(0));
        if (usdg == address(0)) {
            require(block.chainid != 4663, "set USDG on mainnet");
            usdg = address(new MockUSDG());
        }

        string memory json = vm.readFile("script/poseidon.json");
        Hashers memory h =
            Hashers(IPoseidonT3(_create(vm.parseJsonBytes(json, ".t3"))), IPoseidonT4(_create(vm.parseJsonBytes(json, ".t4"))));

        ScreeningGate gate = new ScreeningGate(deployer);
        Verifiers memory v;
        if (vm.envOr("MOCK_VERIFIERS", false)) {
            require(block.chainid != 4663, "mock verifiers on mainnet");
            address m = address(new MockVerifier());
            v = Verifiers(IJoinsplitVerifier(m), ITinRequestVerifier(m), IPpoiVerifier(m));
        } else {
            v = Verifiers(
                IJoinsplitVerifier(address(new JoinsplitVerifier())),
                ITinRequestVerifier(address(new TinRequestVerifier())),
                IPpoiVerifier(address(new PpoiVerifier()))
            );
        }
        StashPool pool = new StashPool(IUSDG(usdg), gate, v, h, deployer, guardian);

        // Token side (Build §10, §14 step 3).
        FOIL foil = new FOIL(safe, 1_000_000_000e18);
        address routerAddr = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 1);
        FoilStaking staking = new FoilStaking(IERC20(address(foil)), IERC20(usdg), routerAddr, owner);
        FeeRouter router = new FeeRouter(
            IERC20(usdg), owner, safe, safe, IRewardNotifier(address(staking)), vm.envOr("BURN_SINK", address(0xdEaD))
        );
        require(address(router) == routerAddr, "router address");
        Bonds bonds = new Bonds(IERC20(address(foil)), pool, safe, owner);
        pool.setFeeRouter(address(router));
        pool.setBonds(IOperatorBonds(address(bonds)));

        for (uint256 i = 0; i < providers.length; i++) gate.setProvider(providers[i], true);
        gate.setCleanInbound(address(pool), true);
        if (operator != address(0)) {
            pool.setOperator(operator, true);
            if (safe == deployer) {
                foil.approve(address(bonds), bonds.OPERATOR_BOND());
                bonds.bondFor(operator, Bonds.Role.Operator);
            }
        }
        bool live = block.chainid == 4663 || block.chainid == 46630;
        uint256 maxDeposit = vm.envOr("MAX_DEPOSIT", live ? uint256(1_000e6) : 0);
        uint256 maxTotal = vm.envOr("MAX_TOTAL", live ? uint256(500_000e6) : 0);
        if (maxDeposit != 0 || maxTotal != 0) pool.setCaps(maxDeposit, maxTotal);
        if (owner != deployer) {
            gate.transferOwnership(owner);
            pool.transferOwnership(owner);
        }
        vm.stopBroadcast();

        string memory o = "deployment";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeUint(o, "startBlock", block.number);
        vm.serializeAddress(o, "usdg", usdg);
        vm.serializeAddress(o, "owner", owner);
        vm.serializeAddress(o, "safe", safe);
        // Expected config for script/PostDeployCheck.s.sol.
        // Read back from the contracts: keeping the locals alive this long is stack-too-deep.
        vm.serializeAddress(o, "guardian", pool.guardian());
        vm.serializeAddress(o, "burnSink", router.burnSink());
        vm.serializeUint(o, "maxDeposit", pool.maxDeposit());
        vm.serializeUint(o, "maxTotal", pool.maxTotal());
        vm.serializeAddress(o, "gate", address(gate));
        vm.serializeAddress(o, "poseidonT3", address(h.t3));
        vm.serializeAddress(o, "poseidonT4", address(h.t4));
        vm.serializeAddress(o, "foil", address(foil));
        vm.serializeAddress(o, "staking", address(staking));
        vm.serializeAddress(o, "feeRouter", address(router));
        vm.serializeAddress(o, "bonds", address(bonds));
        string memory out = vm.serializeAddress(o, "pool", address(pool));
        vm.writeJson(out, string.concat("deployments/", vm.toString(block.chainid), ".json"));
        console.log("StashPool", address(pool));
    }

    /// 24h TimelockController: the Safe proposes and executes; nobody else, no admin.
    function _timelock(address safe) internal returns (address) {
        address[] memory s = new address[](1);
        s[0] = safe;
        return address(new TimelockController(24 hours, s, s, address(0)));
    }

    function _create(bytes memory code) internal returns (address a) {
        assembly {
            a := create(0, add(code, 0x20), mload(code))
        }
        require(a != address(0), "create failed");
    }
}
