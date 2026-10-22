// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

/// @notice Accepts any proof unless told otherwise. Tests assert the exact public
/// signals the pool sends with vm.expectCall.
contract MockVerifier {
    bool public accept = true;

    function setAccept(bool a) external {
        accept = a;
    }

    function verifyProof(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[9] calldata)
        external
        view
        returns (bool)
    {
        return accept;
    }

    function verifyProof(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[13] calldata)
        external
        view
        returns (bool)
    {
        return accept;
    }

    function verifyProof(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[2] calldata)
        external
        view
        returns (bool)
    {
        return accept;
    }
}
