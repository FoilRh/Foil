// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

/// poseidon-solidity's pre-built PoseidonT3/T4 (circomlib-compatible). Deployed from the
/// package's own bytecode (contracts/script/poseidon.json); compiling them ourselves with
/// via_ir exceeds EIP-170.
interface IPoseidonT3 {
    function hash(uint256[2] memory) external pure returns (uint256);
}

interface IPoseidonT4 {
    function hash(uint256[3] memory) external pure returns (uint256);
}

struct Hashers {
    IPoseidonT3 t3;
    IPoseidonT4 t4;
}
