// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

/// Stands in for Bonds in pool-only tests: an allowlist of bonded operators.
contract MockBonds {
    mapping(address => bool) public bonded;

    function set(address who, bool b) external {
        bonded[who] = b;
    }

    function isBonded(address who, uint8) external view returns (bool) {
        return bonded[who];
    }
}
