// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {StashPool} from "./StashPool.sol";

/// @title Bonds (Build §10). Relayers bond 20,000 $FOIL, round operators 30,000.
/// Slashing needs 3 of 5 attestor votes and then a 48h timelock, for:
///   Liveness  a closed round not executed within 60 min (checked on-chain; "without
///             cause" is the attestors' judgement)
///   Omission  an executed round that left out a request the operator had receipted
///             (the operator's own EIP-712 reveal receipt, verified on-chain)
///   BadReveal a mismatched reveal (evidence is the failed tx; attestors judge)
/// A bond under a slash proposal with at least 2 votes cannot be withdrawn (one attestor
/// alone cannot freeze it; the 14-day unbond delay leaves time to gather votes). The
/// same evidence backs one open proposal at a time. A proposal that does not reach 3
/// votes within 7 days, or whose attestor set was replaced, expires. An operator bond
/// cannot be withdrawn while the address is still a pool operator. Slashed $FOIL goes
/// to the treasury.
contract Bonds is Ownable {
    using SafeERC20 for IERC20;

    enum Role { Relayer, Operator }
    enum Cause { Liveness, Omission, BadReveal }

    uint256 public constant RELAYER_BOND = 20_000e18;
    uint256 public constant OPERATOR_BOND = 30_000e18;
    uint256 public constant UNBOND_DELAY = 14 days;
    uint256 public constant SLASH_DELAY = 48 hours;
    uint8 public constant VOTES_NEEDED = 3;
    uint256 public constant ATTESTORS = 5;
    uint256 public constant LIVENESS = 60 minutes;
    uint256 public constant VOTE_WINDOW = 7 days;

    bytes32 private constant RECEIPT_TYPEHASH = keccak256("RevealReceipt(uint256 roundId,uint256 tinCommit,uint64 receivedAt)");
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    IERC20 public immutable foil;
    StashPool public immutable pool;
    address public treasury;
    address[] public attestors;
    /// Increments on every setAttestors; votes only count within one epoch.
    uint32 public attestorEpoch;

    struct Bond {
        uint256 amount;
        uint64 unbondAt;
        uint32 openSlashes;
    }

    struct Slash {
        address who;
        Role role;
        Cause cause;
        uint64 approvedAt;
        uint8 votes;
        bool executed;
        bool expired;
        uint64 proposedAt;
        uint32 epoch;
        uint256 amount;
        bytes32 evidence;
    }

    mapping(address => mapping(Role => Bond)) public bonds;
    Slash[] public slashes;
    mapping(uint256 => mapping(address => bool)) public voted;
    /// keccak(who, role, cause, evidence) → an open or executed proposal already uses it.
    mapping(bytes32 => bool) public evidenceUsed;

    /// @notice `who` bonded `amount` $FOIL for `role`.
    event Bonded(address indexed who, Role role, uint256 amount);
    /// @notice `who` started the unbond delay; the bond is withdrawable from `at`.
    event UnbondRequested(address indexed who, Role role, uint64 at);
    /// @notice `who` withdrew its `role` bond of `amount` $FOIL.
    event Unbonded(address indexed who, Role role, uint256 amount);
    /// @notice An attestor proposed slashing `who`. `evidence`: keccak(roundId) for Liveness, keccak(receipt sig)
    /// for Omission, the failed tx hash for BadReveal.
    event SlashProposed(uint256 indexed id, address indexed who, Role role, Cause cause, uint256 amount, bytes32 evidence);
    /// @notice `attestor` voted for slash `id`; `votes` is the new tally.
    event SlashVoted(uint256 indexed id, address attestor, uint8 votes);
    /// @notice Slash `id` executed: `amount` $FOIL of `who`'s bond went to the treasury.
    event Slashed(uint256 indexed id, address indexed who, uint256 amount);
    /// @notice The attestor set was replaced (new epoch: open proposals of the old set can expire).
    event AttestorsSet(address[] attestors);
    /// @notice Slashed $FOIL now goes to `treasury`.
    event TreasurySet(address treasury);
    /// @notice Slash `id` expired unapproved and no longer blocks the bond.
    event SlashExpired(uint256 indexed id);

    error AlreadyBonded();
    error NotBonded();
    error NotAttestor();
    error Unbonding();
    error SlashPending();
    error AlreadyVoted();
    error NotApproved();
    error TooEarly();
    error BadEvidence();
    error BadAttestors();
    error StillOperator();
    error ZeroAddress();

    constructor(IERC20 foil_, StashPool pool_, address treasury_, address owner_) Ownable(owner_) {
        foil = foil_;
        pool = pool_;
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
    }

    /// @notice Bond size for role `r` in $FOIL (18 decimals).
    function required(Role r) public pure returns (uint256) {
        return r == Role.Relayer ? RELAYER_BOND : OPERATOR_BOND;
    }

    /// @notice True if `who` holds the full bond for `r` and has not requested an unbond.
    function isBonded(address who, Role r) external view returns (bool) {
        Bond storage b = bonds[who][r];
        return b.amount >= required(r) && b.unbondAt == 0;
    }

    // ---------------------------------------------------------------- bonding

    /// @notice Bond the required $FOIL for `r` from the caller.
    function bond(Role r) external {
        bondFor(msg.sender, r);
    }

    /// @notice Bond for `who`, paid by the caller (e.g. a deployer bonding a keeper key
    /// that holds no $FOIL). Only `who` can unbond and receives the bond back.
    function bondFor(address who, Role r) public {
        if (who == address(0)) revert ZeroAddress();
        Bond storage b = bonds[who][r];
        if (b.amount != 0) revert AlreadyBonded();
        b.amount = required(r);
        foil.safeTransferFrom(msg.sender, address(this), b.amount);
        emit Bonded(who, r, b.amount);
    }

    /// @notice Start the 14-day unbond delay for the caller's `r` bond. It stops counting as bonded at once.
    function requestUnbond(Role r) external {
        Bond storage b = bonds[msg.sender][r];
        if (b.amount == 0) revert NotBonded();
        if (b.unbondAt != 0) revert Unbonding();
        b.unbondAt = uint64(block.timestamp + UNBOND_DELAY);
        emit UnbondRequested(msg.sender, r, b.unbondAt);
    }

    /// @notice After the unbond delay, return the caller's `r` bond. Blocked while a slash is open and, for
    /// operators, while still a pool operator.
    function withdraw(Role r) external {
        Bond storage b = bonds[msg.sender][r];
        if (b.unbondAt == 0 || block.timestamp < b.unbondAt) revert TooEarly();
        if (b.openSlashes != 0) revert SlashPending();
        if (r == Role.Operator && pool.operators(msg.sender)) revert StillOperator();
        uint256 amount = b.amount;
        delete bonds[msg.sender][r];
        foil.safeTransfer(msg.sender, amount);
        emit Unbonded(msg.sender, r, amount);
    }

    // ---------------------------------------------------------------- slashing

    /// @notice Replace the 5 slashing attestors (owner, through the timelock). All distinct and non-zero; bumps
    /// attestorEpoch, so votes of the old set stop counting.
    function setAttestors(address[] calldata a) external onlyOwner {
        if (a.length != ATTESTORS) revert BadAttestors();
        for (uint256 i = 0; i < a.length; i++) {
            for (uint256 j = i + 1; j < a.length; j++) if (a[i] == a[j]) revert BadAttestors();
        }
        for (uint256 i = 0; i < a.length; i++) if (a[i] == address(0)) revert BadAttestors();
        attestors = a;
        attestorEpoch += 1;
        emit AttestorsSet(a);
    }

    /// @notice Where slashed $FOIL goes (owner, through the timelock).
    function setTreasury(address t) external onlyOwner {
        if (t == address(0)) revert ZeroAddress();
        treasury = t;
        emit TreasurySet(t);
    }

    /// @notice A closed round that was not executed within 60 minutes of closing.
    /// @dev Attestors only; the proposal counts as the first of 3 votes.
    /// @param amount $FOIL to slash (capped at the bond on execute).
    /// @return Slash id.
    function proposeLiveness(address operator, uint256 roundId, uint256 amount) external returns (uint256) {
        (, uint64 closedAt, uint64 executedAt,) = pool.rounds(roundId);
        bool late = closedAt != 0 && (executedAt == 0 ? block.timestamp > closedAt + LIVENESS : executedAt > closedAt + LIVENESS);
        if (!late) revert BadEvidence();
        return _propose(operator, Role.Operator, Cause.Liveness, amount, keccak256(abi.encode(roundId)));
    }

    /// @notice The operator signed a receipt for a reveal it got before the round closed, was the
    /// round's executor, and left that request out (still Pending 60 minutes after close,
    /// or self-executed by the user). receivedAt is checked against closedAt, so a receipt
    /// with a far-future time proves nothing for the operator.
    /// @dev Attestors only; the proposal counts as the first of 3 votes.
    /// @param sig The operator's ECDSA signature of receiptDigest(roundId, tinCommit, receivedAt).
    /// @param amount $FOIL to slash (capped at the bond on execute).
    /// @return Slash id.
    function proposeOmission(address operator, uint256 roundId, uint256 tinCommit, uint64 receivedAt, bytes calldata sig, uint256 amount)
        external
        returns (uint256)
    {
        if (ECDSA.recover(receiptDigest(roundId, tinCommit, receivedAt), sig) != operator) revert BadEvidence();
        uint256 ref = pool.requestOfCommit(tinCommit);
        if (ref == 0 || ref >> 32 != roundId) revert BadEvidence();
        (, uint64 closedAt, uint64 executedAt,) = pool.rounds(roundId);
        if (pool.roundExecutor(roundId) != operator) revert BadEvidence();
        StashPool.RequestState st = pool.getRequest(roundId, (ref & type(uint32).max) - 1).state;
        bool omitted = executedAt != 0 && receivedAt <= closedAt && block.timestamp > uint256(closedAt) + LIVENESS
            && (st == StashPool.RequestState.Pending || st == StashPool.RequestState.SelfExecuted);
        if (!omitted) revert BadEvidence();
        return _propose(operator, Role.Operator, Cause.Omission, amount, keccak256(sig));
    }

    /// @notice A mismatched reveal; `failedTx` is the reverted executeRound transaction.
    /// @dev Attestors only; nothing is checked on-chain, the 3-of-5 vote is the check.
    /// @param amount $FOIL to slash (capped at the bond on execute).
    /// @return Slash id.
    function proposeBadReveal(address operator, bytes32 failedTx, uint256 amount) external returns (uint256) {
        return _propose(operator, Role.Operator, Cause.BadReveal, amount, failedTx);
    }

    /// @notice An attestor of the current epoch votes for an open proposal.
    function vote(uint256 id) external {
        _onlyAttestor();
        Slash storage s = slashes[id];
        if (s.executed || s.expired || s.epoch != attestorEpoch || block.timestamp > s.proposedAt + VOTE_WINDOW) revert NotApproved();
        if (voted[id][msg.sender]) revert AlreadyVoted();
        voted[id][msg.sender] = true;
        s.votes += 1;
        if (s.votes == 2) bonds[s.who][s.role].openSlashes += 1; // now it blocks withdrawal
        if (s.votes == VOTES_NEEDED) s.approvedAt = uint64(block.timestamp);
        emit SlashVoted(id, msg.sender, s.votes);
    }

    /// @notice After 3 votes and the 48h timelock, anyone may execute.
    function execute(uint256 id) external {
        Slash storage s = slashes[id];
        if (s.approvedAt == 0 || s.executed || s.expired) revert NotApproved();
        if (block.timestamp < s.approvedAt + SLASH_DELAY) revert TooEarly();
        s.executed = true;
        Bond storage b = bonds[s.who][s.role];
        b.openSlashes -= 1;
        uint256 amount = s.amount > b.amount ? b.amount : s.amount;
        b.amount -= amount;
        foil.safeTransfer(treasury, amount);
        emit Slashed(id, s.who, amount);
    }

    /// @notice Anyone closes a proposal that missed its 7-day vote window or whose attestor
    /// set was replaced, so it no longer blocks the bond.
    function expire(uint256 id) external {
        Slash storage s = slashes[id];
        if (s.executed || s.expired || s.approvedAt != 0) revert NotApproved();
        if (s.epoch == attestorEpoch && block.timestamp <= s.proposedAt + VOTE_WINDOW) revert TooEarly();
        s.expired = true;
        if (s.votes >= 2) bonds[s.who][s.role].openSlashes -= 1;
        evidenceUsed[_evidenceKey(s.who, s.role, s.cause, s.evidence)] = false;
        emit SlashExpired(id);
    }

    /// @notice EIP-712 digest of an operator's reveal receipt (domain FoilRoundOperator/1, verifyingContract =
    /// the pool).
    function receiptDigest(uint256 roundId, uint256 tinCommit, uint64 receivedAt) public view returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("FoilRoundOperator"), keccak256("1"), block.chainid, address(pool))
        );
        return keccak256(
            abi.encodePacked("\x19\x01", domain, keccak256(abi.encode(RECEIPT_TYPEHASH, roundId, tinCommit, receivedAt)))
        );
    }

    /// @notice Number of slash proposals ever made.
    function slashCount() external view returns (uint256) {
        return slashes.length;
    }

    function _propose(address who, Role r, Cause c, uint256 amount, bytes32 evidence) internal returns (uint256 id) {
        _onlyAttestor();
        Bond storage b = bonds[who][r];
        if (b.amount == 0) revert NotBonded();
        bytes32 key = _evidenceKey(who, r, c, evidence);
        if (evidenceUsed[key]) revert BadEvidence();
        evidenceUsed[key] = true;
        id = slashes.length;
        slashes.push(
            Slash({
                who: who,
                role: r,
                cause: c,
                approvedAt: 0,
                votes: 1,
                executed: false,
                expired: false,
                proposedAt: uint64(block.timestamp),
                epoch: attestorEpoch,
                amount: amount,
                evidence: evidence
            })
        );
        voted[id][msg.sender] = true;
        emit SlashProposed(id, who, r, c, amount, evidence);
        emit SlashVoted(id, msg.sender, 1);
    }

    function _evidenceKey(address who, Role r, Cause c, bytes32 evidence) internal pure returns (bytes32) {
        return keccak256(abi.encode(who, r, c, evidence));
    }

    function _onlyAttestor() internal view {
        for (uint256 i = 0; i < attestors.length; i++) if (attestors[i] == msg.sender) return;
        revert NotAttestor();
    }
}
