// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ByteHasher — Helper for hashing bytes into the BN254 scalar field
/// @dev   Used by World ID verification to convert signals and nullifiers
///        into field elements.  The right-shift by 8 guarantees the result
///        fits within the ~254-bit BN254 field order.
/// @custom:reference https://github.com/worldcoin/world-id-onchain-template
library ByteHasher {
    /// @notice Hash arbitrary bytes into a BN254-safe field element.
    /// @param value The bytes to hash.
    /// @return A uint256 guaranteed to be < 2^248 (fits in the BN254 scalar field).
    function hashToField(bytes memory value) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(value))) >> 8;
    }
}
