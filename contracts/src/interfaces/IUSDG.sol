// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice USDG on Robinhood Chain: ERC-20 + EIP-3009 (Build header; "U": confirm
/// receiveWithAuthorization on RHC before mainnet).
interface IUSDG is IERC20 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// @notice An EIP-3009 authorization signed by `from`.
struct Auth3009 {
    address from;
    uint256 value;
    uint256 validAfter;
    uint256 validBefore;
    uint8 v;
    bytes32 r;
    bytes32 s;
}
