// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {IPoseidonT3} from "./interfaces/IPoseidon.sol";

/// @notice Incremental Poseidon(2) Merkle tree, zero leaf = 0. Mirrors
/// packages/client/src/crypto.ts MerkleTree and circuits/src/lib.circom MerkleRoot.
/// 2^32 leaves, so filling it is not a practical attack; every root it ever had stays
/// valid (spent notes are stopped by nullifiers, not by forgetting roots), so no burst
/// of transactions can invalidate a proof in flight.
abstract contract MerkleTree {
    uint256 public constant LEVELS = 32;

    IPoseidonT3 public immutable poseidonT3;
    uint256[LEVELS] public zeros;
    uint256[LEVELS] public filledSubtrees;
    mapping(uint256 => bool) public knownRoot;
    uint256 public lastRoot;
    uint32 public nextIndex;

    error TreeFull();

    constructor(IPoseidonT3 t3) {
        poseidonT3 = t3;
        uint256 z = 0;
        for (uint256 i = 0; i < LEVELS; i++) {
            zeros[i] = z;
            filledSubtrees[i] = z;
            z = t3.hash([z, z]);
        }
        lastRoot = z;
        knownRoot[z] = true;
    }

    /// @dev Appends `leaf` and records the new root. The last index (2^32 − 1) is never
    /// used, so nextIndex cannot overflow.
    function _insert(uint256 leaf) internal returns (uint32 index) {
        index = nextIndex;
        if (index == type(uint32).max) revert TreeFull();
        uint256 cur = leaf;
        uint32 idx = index;
        for (uint256 i = 0; i < LEVELS; i++) {
            if (idx & 1 == 0) {
                filledSubtrees[i] = cur;
                cur = poseidonT3.hash([cur, zeros[i]]);
            } else {
                cur = poseidonT3.hash([filledSubtrees[i], cur]);
            }
            idx >>= 1;
        }
        lastRoot = cur;
        knownRoot[cur] = true;
        nextIndex = index + 1;
    }

    /// @notice True for every root the tree has had (0 is never a root).
    function isKnownRoot(uint256 root) public view returns (bool) {
        return knownRoot[root];
    }
}
