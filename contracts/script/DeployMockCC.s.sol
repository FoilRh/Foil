// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockCards} from "../test/mocks/MockCards.sol";
import {MockGachaVault, IMintableCards} from "../test/mocks/MockGachaVault.sol";
import {MockUSDG} from "../test/mocks/MockUSDG.sol";
import {ScreeningGate} from "../src/ScreeningGate.sol";

/// Testnet only: a Collector Crypt stand-in with the live call shapes (MockGachaVault), so
/// browser mode can be exercised where CC does not exist. Adds `cardNft` and `ccVault` to
/// deployments/<chainid>.json. Env: CC_QUOTE_SIGNER (address that signs sell-back quotes).
contract DeployMockCC is Script {
    function run() external {
        require(block.chainid != 4663, "mainnet uses the real Collector Crypt");
        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        string memory dep = vm.readFile(path);
        address usdg = vm.parseJsonAddress(dep, ".usdg");
        ScreeningGate gate = ScreeningGate(vm.parseJsonAddress(dep, ".gate"));

        vm.startBroadcast();
        MockCards cards = new MockCards();
        MockGachaVault vault = new MockGachaVault(IERC20(usdg), IMintableCards(address(cards)), vm.envAddress("CC_QUOTE_SIGNER"));
        MockUSDG(usdg).mint(address(vault), 1_000_000e6); // buy-back float
        gate.setCleanInbound(address(vault), true); // vault payouts are clean inbound, like the real one
        vm.stopBroadcast();

        vm.writeJson(vm.toString(address(cards)), path, ".cardNft");
        vm.writeJson(vm.toString(address(vault)), path, ".ccVault");
    }
}
