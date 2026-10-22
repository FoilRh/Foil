// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

interface IMintableCards {
    function mint(address to, uint256 id) external;
    function transferFrom(address from, address to, uint256 id) external;
}

/// Stand-in for Collector Crypt's gacha vault with the live call shapes:
///   pay(address token, uint256 amount, string memo)  — takes USDG, mints the pulled card
///   0x60dee04b(token, tokenId, amount, deadline, nonce, quoteSig) — sell-back against a
///   quote signed by quoteSigner (handled in fallback: the real function name is unpublished)
contract MockGachaVault {
    IERC20 public immutable usdg;
    IMintableCards public immutable cards;
    address public immutable quoteSigner;
    uint256 public nextCard = 1000;
    mapping(uint256 => bool) public usedNonce;

    event Paid(address indexed payer, uint256 amount, string memo, uint256 cardId);
    event Buyback(address indexed seller, uint256 tokenId, uint256 amount);

    constructor(IERC20 usdg_, IMintableCards cards_, address quoteSigner_) {
        usdg = usdg_;
        cards = cards_;
        quoteSigner = quoteSigner_;
    }

    function pay(address token, uint256 amount, string calldata memo) external {
        require(token == address(usdg), "token");
        usdg.transferFrom(msg.sender, address(this), amount);
        uint256 id = nextCard++;
        cards.mint(msg.sender, id); // the "pull"
        emit Paid(msg.sender, amount, memo, id);
    }

    fallback() external {
        require(msg.sig == bytes4(0x60dee04b), "unknown");
        (address token, uint256 tokenId, uint256 amount, uint256 deadline, uint256 nonce, bytes memory sig) =
            abi.decode(msg.data[4:], (address, uint256, uint256, uint256, uint256, bytes));
        require(token == address(usdg) && block.timestamp <= deadline && !usedNonce[nonce], "quote");
        bytes32 h = MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encode(msg.sender, tokenId, amount, deadline, nonce)));
        require(ECDSA.recover(h, sig) == quoteSigner, "sig");
        usedNonce[nonce] = true;
        cards.transferFrom(msg.sender, address(this), tokenId);
        usdg.transfer(msg.sender, amount);
        emit Buyback(msg.sender, tokenId, amount);
    }
}
