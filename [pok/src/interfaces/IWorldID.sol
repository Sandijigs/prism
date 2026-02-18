// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IWorldID — Application-facing World ID Router interface
/// @dev   The router dispatches to the correct Identity Manager based on groupId.
///        `verifyProof` reverts if the zero-knowledge proof is invalid;
///        it does NOT return a boolean.
/// @custom:reference https://docs.world.org/world-id/reference/contracts
interface IWorldID {
    /// @notice Verifies a World ID zero-knowledge proof.
    /// @param root                The Merkle tree root (supplied by IDKit).
    /// @param groupId             The credential group (1 = Orb verification).
    /// @param signalHash          keccak256 hash of the signal, reduced to the BN254 field.
    /// @param nullifierHash       Unique per-user nullifier (supplied by IDKit).
    /// @param externalNullifierHash  Scoped nullifier derived from appId + actionId.
    /// @param proof               Groth16 proof encoded as 8 uint256 values.
    function verifyProof(
        uint256 root,
        uint256 groupId,
        uint256 signalHash,
        uint256 nullifierHash,
        uint256 externalNullifierHash,
        uint256[8] calldata proof
    ) external view;
}
