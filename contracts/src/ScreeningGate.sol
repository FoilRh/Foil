// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @notice Screening providers (ppoi-nodes) and the clean-inbound allowlist (Build §1, §3.1, §3.3).
/// The owner is a TimelockController (24h) whose proposer is the 2-of-3 Safe, so the
/// provider set and allowlist only change with a public delay. Each provider updates its
/// own sparse-Merkle root (the list it screens against) without the timelock.
contract ScreeningGate is Ownable {
    uint256 public constant FRESH_WINDOW = 2 hours;
    uint256 public constant STANDBY = 15 minutes;
    uint256 public constant STANDBY_DEGRADED = 60 minutes;
    uint256 public constant MIN_SIGNATURES = 2;

    struct Provider {
        bool active;
        uint256 root;
        uint64 rootUpdatedAt;
    }

    mapping(address => Provider) public providers;
    address[] public providerList;
    /// Addresses whose USDG inbound to a tin counts as clean: the Stash pool, CC GachaVault.
    mapping(address => bool) public cleanInbound;

    /// @notice A provider was added, activated or deactivated.
    event ProviderSet(address indexed provider, bool active);
    /// @notice A provider published a new list root (its heartbeat).
    event ProviderRoot(address indexed provider, uint256 root);
    /// @notice `source` was added to or removed from the clean-inbound allowlist.
    event CleanInbound(address indexed source, bool allowed);

    error NotProvider();
    error BadRoot();
    error NotEnoughSignatures();

    constructor(address owner_) Ownable(owner_) {}

    /// @notice Activate or deactivate a screening provider (owner, through the timelock).
    function setProvider(address provider, bool active) external onlyOwner {
        if (active && !_known(provider)) providerList.push(provider);
        providers[provider].active = active;
        emit ProviderSet(provider, active);
    }

    /// @notice Allow or remove `source` as a clean USDG source for send-backs (owner, through the timelock).
    function setCleanInbound(address source, bool allowed) external onlyOwner {
        cleanInbound[source] = allowed;
        emit CleanInbound(source, allowed);
    }

    /// @notice Providers publish their current list root at least hourly; that is their heartbeat.
    /// @param root Sparse-Merkle root of the provider's list; non-zero and below the SNARK field.
    function updateRoot(uint256 root) external {
        Provider storage p = providers[msg.sender];
        if (!p.active) revert NotProvider();
        // A root outside the SNARK field could never be a public input, so it would
        // silently disable the proof path for every entry.
        if (root == 0 || root >= 21888242871839275222246405745257275088548364400416034343698204186575808495617) revert BadRoot();
        p.root = root;
        p.rootUpdatedAt = uint64(block.timestamp);
        emit ProviderRoot(msg.sender, root);
    }

    /// @notice True if `a` is an active provider.
    function isProvider(address a) public view returns (bool) {
        return providers[a].active;
    }

    /// @notice True if `a` is active and published a root within the last 2 hours.
    function isFresh(address a) public view returns (bool) {
        Provider storage p = providers[a];
        return p.active && block.timestamp - p.rootUpdatedAt <= FRESH_WINDOW;
    }

    /// @notice Fresh active providers. Callers that need one proof per provider iterate this.
    function freshProviders() public view returns (address[] memory out) {
        uint256 n;
        address[] memory tmp = new address[](providerList.length);
        for (uint256 i = 0; i < providerList.length; i++) {
            if (isFresh(providerList[i])) tmp[n++] = providerList[i];
        }
        out = new address[](n);
        for (uint256 i = 0; i < n; i++) out[i] = tmp[i];
    }

    /// @notice 15 min with ≥ 2 fresh providers, otherwise 60 min (Build §3.1).
    function standby() external view returns (uint256) {
        return freshProviders().length >= MIN_SIGNATURES ? STANDBY : STANDBY_DEGRADED;
    }

    /// @notice Reverts unless ≥ 2 distinct active providers signed `digest` (EIP-191 personal sign).
    /// @param digest The pool's admitDigest(seq).
    function requireSignatures(bytes32 digest, bytes[] calldata sigs) external view {
        bytes32 h = MessageHashUtils.toEthSignedMessageHash(digest);
        address[] memory seen = new address[](sigs.length);
        uint256 n;
        for (uint256 i = 0; i < sigs.length; i++) {
            address s = ECDSA.recover(h, sigs[i]);
            if (!providers[s].active) continue;
            bool dup;
            for (uint256 j = 0; j < n; j++) if (seen[j] == s) dup = true;
            if (dup) continue;
            seen[n++] = s;
        }
        if (n < MIN_SIGNATURES) revert NotEnoughSignatures();
    }

    function _known(address a) private view returns (bool) {
        for (uint256 i = 0; i < providerList.length; i++) if (providerList[i] == a) return true;
        return false;
    }
}
