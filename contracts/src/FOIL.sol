// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title $FOIL (Build §10). Fixed supply minted once to the 2-of-3 Safe; no owner,
/// no mint function, holders can burn.
contract FOIL is ERC20, ERC20Burnable, ERC20Permit {
    constructor(address safe, uint256 supply) ERC20("Foil", "FOIL") ERC20Permit("Foil") {
        _mint(safe, supply);
    }
}
