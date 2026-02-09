// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IWorldID } from "./interfaces/IWorldID.sol";
import { ByteHasher } from "./libraries/ByteHasher.sol";

/// @notice Minimal interface for propagating verification status to PRISM contracts.
interface IVerifiable {
    function setVerificationStatus(address user, bool verified) external;
}

/// @title WorldIDGate — Sybil-resistant verification for PRISM Protocol
/// @notice Verifies World ID proofs on-chain and maintains a registry of verified
///         users.  Other PRISM contracts (RiskMarket, ShieldVault) reference this
///         registry via `isVerified(address)`.
/// @dev    Supports two modes:
///         1. **Live mode** — calls the World ID Router to verify Groth16 proofs.
///         2. **Mock mode** — owner can mark users as verified without a proof,
///            enabling demos on chains where World ID infrastructure is unavailable.
contract WorldIDGate is Ownable {
    using ByteHasher for bytes;

    // ── State ────────────────────────────────────────────────────────────

    /// @notice World ID Router contract for on-chain proof verification.
    IWorldID public immutable worldId;

    /// @notice External nullifier hash, scoped to this app + action.
    /// @dev    Computed as: hash( hash(appId) || actionId ).
    uint256 public immutable externalNullifier;

    /// @notice World ID credential group (1 = Orb verification).
    uint256 public immutable groupId;

    /// @notice Whether mock verification mode is active (owner-only fast-path).
    bool public useMockVerification;

    /// @notice RiskMarket contract to propagate verification status to.
    IVerifiable public riskMarket;

    /// @notice ShieldVault contract (optional — for future propagation).
    address public shieldVault;

    /// @notice CRE workflow address authorised for off-chain verification relay.
    address public creWorkflow;

    /// @notice Nullifier hashes that have already been consumed (prevents double-reg).
    mapping(uint256 => bool) public nullifierHashes;

    /// @notice Verified status per user address.
    mapping(address => bool) public verified;

    // ── Events ───────────────────────────────────────────────────────────

    /// @notice Emitted when a user is verified (via proof or mock).
    event UserVerified(address indexed user);

    /// @notice Emitted when mock verification mode is toggled.
    event MockModeChanged(bool enabled);

    // ── Errors ───────────────────────────────────────────────────────────

    error DuplicateNullifier(uint256 nullifierHash);
    error AlreadyVerified();
    error NotAuthorized();
    error ZeroAddress();

    // ── Constructor ──────────────────────────────────────────────────────

    /// @notice Deploy the WorldIDGate.
    /// @param _worldId   World ID Router address (address(0) allowed for mock-only deployments).
    /// @param _appId     World ID application identifier (e.g. "app_...").
    /// @param _actionId  World ID action identifier (e.g. "prism-verify").
    /// @param _groupId   Credential group (1 for Orb).
    constructor(
        IWorldID _worldId,
        string memory _appId,
        string memory _actionId,
        uint256 _groupId
    ) Ownable(msg.sender) {
        worldId = _worldId;
        groupId = _groupId;

        // Compute scoped external nullifier: hash( hash(appId) || actionId )
        externalNullifier = abi.encodePacked(
            abi.encodePacked(_appId).hashToField(),
            _actionId
        ).hashToField();
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Core Verification
    // ══════════════════════════════════════════════════════════════════════

    /// @notice Verify a World ID proof and register the caller as verified.
    /// @dev    The `signal` is typically the caller's address, binding the proof
    ///         to a specific wallet.  The World ID Router reverts if the proof is
    ///         invalid — no boolean return value.
    /// @param signal        The signal to bind (usually msg.sender's address).
    /// @param root          Merkle tree root from IDKit.
    /// @param nullifierHash Per-user nullifier from IDKit.
    /// @param proof         Groth16 proof encoded as 8 uint256 values.
    function verifyAndRegister(
        address signal,
        uint256 root,
        uint256 nullifierHash,
        uint256[8] calldata proof
    ) external {
        // Prevent double-registration with the same World ID
        if (nullifierHashes[nullifierHash]) revert DuplicateNullifier(nullifierHash);

        // Verify the ZK proof via the World ID Router (reverts on failure)
        worldId.verifyProof(
            root,
            groupId,
            abi.encodePacked(signal).hashToField(),
            nullifierHash,
            externalNullifier,
            proof
        );

        // Record nullifier and mark user as verified
        nullifierHashes[nullifierHash] = true;
        _setVerified(signal);
    }

    /// @notice Check whether an address has been verified.
    /// @param user Address to query.
    /// @return True if the user has passed World ID verification.
    function isVerified(address user) external view returns (bool) {
        return verified[user];
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Mock Mode (Hackathon Demo)
    // ══════════════════════════════════════════════════════════════════════

    /// @notice Mark a user as verified without a real World ID proof.
    /// @dev    Only available when `useMockVerification` is true.
    ///         Callable by the owner or the authorised CRE workflow.
    /// @param user Address to mark as verified.
    function mockVerify(address user) external {
        require(useMockVerification, "Mock mode disabled");
        if (msg.sender != owner() && msg.sender != creWorkflow) revert NotAuthorized();
        if (user == address(0)) revert ZeroAddress();

        _setVerified(user);
    }

    /// @notice Toggle mock verification mode.
    /// @param enabled True to enable mock mode, false to require real proofs.
    function setMockMode(bool enabled) external onlyOwner {
        useMockVerification = enabled;
        emit MockModeChanged(enabled);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Admin
    // ══════════════════════════════════════════════════════════════════════

    /// @notice Set the RiskMarket contract for verification propagation.
    function setRiskMarket(address _riskMarket) external onlyOwner {
        if (_riskMarket == address(0)) revert ZeroAddress();
        riskMarket = IVerifiable(_riskMarket);
    }

    /// @notice Set the ShieldVault address (for future propagation).
    function setShieldVault(address _shieldVault) external onlyOwner {
        shieldVault = _shieldVault;
    }

    /// @notice Set the CRE workflow address for off-chain verification relay.
    function setCreWorkflow(address _workflow) external onlyOwner {
        creWorkflow = _workflow;
    }

    // ── Internal ─────────────────────────────────────────────────────────

    /// @dev Mark a user as verified and propagate to downstream contracts.
    function _setVerified(address user) internal {
        verified[user] = true;

        // Propagate to RiskMarket so the AMM applies full weight
        if (address(riskMarket) != address(0)) {
            riskMarket.setVerificationStatus(user, true);
        }

        emit UserVerified(user);
    }
}
