// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title PRISMToken — Governance and utility token for the PRISM Protocol
/// @notice Standard ERC-20 with a fixed initial supply of 1 000 000 PRISM
///         minted to the deployer.  Intended for governance signaling and
///         future protocol utility.
contract PRISMToken is ERC20 {
    uint256 public constant INITIAL_SUPPLY = 1_000_000 ether;

    constructor() ERC20("PRISM Protocol", "PRISM") {
        _mint(msg.sender, INITIAL_SUPPLY);
    }
}
