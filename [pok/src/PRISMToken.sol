// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title PRISMToken — Governance and utility token for the PRISM Protocol
/// @notice Standard ERC-20 with a fixed initial supply of 1 000 000 PRISM
///         minted to the deployer.  Owner can mint additional tokens for
///         future governance rewards.
contract PRISMToken is ERC20, Ownable {
    uint256 public constant INITIAL_SUPPLY = 1_000_000 ether;

    constructor() ERC20("PRISM Protocol", "PRISM") Ownable(msg.sender) {
        _mint(msg.sender, INITIAL_SUPPLY);
    }

    /// @notice Mint additional PRISM tokens (for future governance rewards).
    /// @param to     Recipient address.
    /// @param amount Amount to mint (18-decimal).
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
