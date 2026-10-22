// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {Hashers, IPoseidonT3, IPoseidonT4} from "../../src/interfaces/IPoseidon.sol";

/// Deploys poseidon-solidity's pre-built PoseidonT3/T4 from script/poseidon.json.
library DeployHashers {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function deploy() internal returns (Hashers memory h) {
        string memory json = vm.readFile("script/poseidon.json");
        h.t3 = IPoseidonT3(_create(vm.parseJsonBytes(json, ".t3")));
        h.t4 = IPoseidonT4(_create(vm.parseJsonBytes(json, ".t4")));
    }

    function _create(bytes memory code) private returns (address a) {
        assembly ("memory-safe") {
            a := create(0, add(code, 0x20), mload(code))
        }
        require(a != address(0) && a.code.length > 0, "poseidon deploy failed");
    }
}
