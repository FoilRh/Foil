// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// Stand-in for Collector Crypt's card NFT in tests (Rip Rooms, indexer).
contract MockCards is ERC721 {
    constructor() ERC721("Mock Cards", "CARD") {}

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }
}
