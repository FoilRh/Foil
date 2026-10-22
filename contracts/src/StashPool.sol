// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {MerkleTree} from "./MerkleTree.sol";
import {Hashers, IPoseidonT4} from "./interfaces/IPoseidon.sol";
import {ScreeningGate} from "./ScreeningGate.sol";
import {IUSDG, Auth3009} from "./interfaces/IUSDG.sol";
import {IJoinsplitVerifier, IPpoiVerifier, ITinRequestVerifier, Proof} from "./interfaces/IVerifiers.sol";

/// The slice of Bonds the pool reads (Bonds imports StashPool, so no import back).
interface IOperatorBonds {
    /// @notice True if `who` holds a full, not-unbonding bond for `role` (1 = Operator).
    function isBonded(address who, uint8 role) external view returns (bool);
}

struct Verifiers {
    IJoinsplitVerifier joinsplit;
    ITinRequestVerifier tinRequest;
    IPpoiVerifier ppoi;
}

/// @title Foil Stash pool with funding rounds (Build §3.1, §3.2, §3.3)
/// @notice Shielded USDG notes. Deposits and send-backs wait in an entry queue until
/// screened; only admitted entries become leaves. Every function keeps
/// USDG.balanceOf(pool) >= totalIn - totalOut. No proxy: the code is immutable; the
/// owner (24h TimelockController) can only change bounded parameters.
contract StashPool is MerkleTree, Ownable, EIP712, ReentrancyGuardTransient {
    using SafeERC20 for IUSDG;

    uint256 internal constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 internal constant MAX_AMOUNT = 1 << 120;

    uint256 public constant DEPOSIT_FEE_BPS = 15;
    uint256 public constant WITHDRAW_FEE_BPS = 25;
    uint256 public constant SEND_BACK_OVER_BPS = 25;
    uint256 public constant SEND_BACK_MIN = 1e6;
    uint8 public constant SEND_BACK_MAX = 10;
    /// Smallest deposit: each admitted entry is a leaf, so dust deposits are refused.
    uint256 public constant MIN_DEPOSIT = 1e6;
    /// Cap on the relayer fee leg (transact, requestTin). The fee leg pays no protocol
    /// fee, so it is capped near a relayer's cost instead.
    uint256 public constant MAX_RELAYER_FEE = 5e6;

    IUSDG public immutable usdg;
    ScreeningGate public immutable gate;
    IJoinsplitVerifier public immutable joinsplitVerifier;
    IPpoiVerifier public immutable ppoiVerifier;
    ITinRequestVerifier public immutable tinRequestVerifier;
    IPoseidonT4 public immutable poseidonT4;
    /// Nullifier domain and extDataHash domain: binds proofs to this pool on this chain.
    uint256 public immutable POOL_ID;

    // ---- conservation counters (public, Build §3.1) ----
    uint256 public totalIn;
    uint256 public totalOut;
    uint256 public feesAccrued;
    uint256 public pendingTotal;

    // ---- entry queue ----
    enum EntryState { None, Pending, Admitted, Flagged, Refunded }
    enum EntryKind { Deposit, SendBack }

    struct Entry {
        address origin;
        EntryKind kind;
        EntryState state;
        uint64 standbyEnds;
        uint256 gross; // measured amount received
        uint256 fee; // charged only on admission
        uint256 npk;
    }

    mapping(uint256 => Entry) public entries;
    uint256 public nextSeq;

    mapping(uint256 => bool) public nullifierSpent;

    // ---- tins (public chain facts) ----
    mapping(address => uint256) public tinFunded;
    mapping(address => uint256) public tinSentBack;
    mapping(address => uint8) public tinSendBacks;

    // ---- guardian ----
    address public guardian;
    bool public depositsPaused;
    bool public requestsPaused;

    bytes32 private constant EXIT_TYPEHASH = keccak256("ExitPending(uint256 seq,uint256 deadline)");

    // ---- funding rounds (Build §3.2) ----
    uint256 public constant TIN_FEE_BPS = 15;
    uint256 public constant TIN_FEE_FLAT = 200_000; // $0.20
    uint256 public constant ROUND_CADENCE = 10 minutes;
    uint256 public constant CLOSE_WINDOW = 2 minutes; // a close lands within 2 min of a boundary
    uint256 public constant ROUND_MIN_REQUESTS = 8;
    uint256 public constant ROUND_MAX_WAIT = 30 minutes;
    uint256 public constant LIVENESS = 60 minutes;
    uint256 public constant MAX_GAS_FEE = 5e6; // bound on gasFeeUsdg
    uint256 public constant MAX_ETH_PER_TIN = 0.005 ether;

    /// Unfundable: the tin refused the USDG transfer; only the requester can cancel it.
    enum RequestState { None, Pending, Executed, SelfExecuted, Cancelled, Unfundable }

    struct Round {
        uint64 openedAt; // first request's time
        uint64 closedAt;
        uint64 executedAt;
        uint32 count;
    }

    struct Request {
        uint256 tinCommit; // keccak(tin, salt, size, roundId) mod p
        uint256 refundCommit; // note of `reserved`, owned by the requester (proved)
        uint256 cancelHash; // keccak(cancelSecret) mod p
        uint128 size;
        uint128 reserved; // size + tin fee + gas fee
        uint128 gasFee;
        RequestState state;
    }

    struct TinRequestArgs {
        uint256 root;
        uint256[2] nullifiers;
        uint256 changeCommitment;
        uint256 size;
        uint256 fee; // relayer fee
        uint256 roundId;
        uint256 tinCommit;
        uint256 refundCommit;
        uint256 cancelHash;
        address relayer;
        bytes encryptedChange;
    }

    uint256 public currentRound;
    mapping(uint256 => Round) public rounds;
    mapping(uint256 => Request[]) internal _requests;
    /// tinCommit → (roundId << 32 | reqIdx + 1); 0 = unused. Each commit can be requested once.
    mapping(uint256 => uint256) public requestOfCommit;
    uint256 public reservedTotal;
    /// Canary caps on deposits (0 = none); see setCaps.
    uint256 public maxDeposit;
    uint256 public maxTotal;

    /// Gas at cost, in USDG, reimbursed to the operator who fronts ethPerTin (owner-set, bounded).
    uint256 public gasFeeUsdg = 1e6;
    uint256 public ethPerTin = 0.0004 ether;
    mapping(address => bool) public operators;
    address public feeRouter;
    /// Bonds contract: executeRound needs a bonded operator (Build §10).
    IOperatorBonds public bonds;
    /// First operator to execute part of each round (Bonds binds omission slashes to it).
    mapping(uint256 => address) public roundExecutor;

    struct ExtData {
        address recipient;
        int256 extAmount; // ≤ 0: amount leaving the pool to `recipient`
        address relayer;
        uint256 fee; // relayer fee, paid in USDG from the notes
        bytes encryptedOutput1;
        bytes encryptedOutput2;
    }

    /// @notice A deposit or send-back joined the entry queue; `ciphertext` and `epk` carry the note for its
    /// owner's wallet.
    event EntryCreated(uint256 indexed seq, EntryKind kind, address indexed origin, uint256 gross, uint256 npk, bytes ciphertext, bytes epk);
    /// @notice Entry `seq` became leaf `leafIndex` with the on-chain `commitment`.
    event EntryAdmitted(uint256 indexed seq, uint256 commitment, uint32 leafIndex);
    /// @notice `provider` flagged entry `seq`; it can now only be refunded.
    event EntryFlagged(uint256 indexed seq, address indexed provider);
    /// @notice Entry `seq` was refunded in full to `origin`.
    event EntryRefunded(uint256 indexed seq, address indexed origin, uint256 amount);
    /// @notice A note commitment was appended at `leafIndex`.
    event NewCommitment(uint256 commitment, uint32 leafIndex, bytes encryptedOutput);
    /// @notice A note nullifier was spent.
    event NewNullifier(uint256 nullifier);
    /// @notice `amount` USDG left the pool to `recipient`; `protocolFee` stays for the FeeRouter.
    event Withdrawal(address indexed recipient, uint256 amount, uint256 protocolFee);
    /// @notice The pause-only guardian changed.
    event GuardianSet(address guardian);
    /// @notice New pause flags for deposits and tin requests. Exits are never paused.
    event Paused(bool deposits, bool requests);
    /// @notice A tin request joined round `roundId` at index `reqIdx`.
    event TinRequested(uint256 indexed roundId, uint256 reqIdx, uint256 tinCommit, uint256 size);
    /// @notice Round `roundId` closed with `count` requests; the next round opened.
    event RoundClosed(uint256 indexed roundId, uint256 count);
    /// @notice `operator` funded `executed` requests of round `roundId` in one call.
    event RoundExecuted(uint256 indexed roundId, address indexed operator, uint256 executed);
    /// @notice `tin` received `size` USDG for request `reqIdx` (`how`: Executed or SelfExecuted).
    event TinFunded(uint256 indexed roundId, uint256 reqIdx, address indexed tin, uint256 size, RequestState how);
    /// @notice A request was cancelled; its refund note is leaf `refundLeaf`.
    event RequestCancelled(uint256 indexed roundId, uint256 reqIdx, uint32 refundLeaf);
    /// @notice New gas fee (USDG) and ETH per tin.
    event ParamsSet(uint256 gasFeeUsdg, uint256 ethPerTin);
    /// @notice New canary caps (0 = none).
    event CapsSet(uint256 maxDeposit, uint256 maxTotal);
    /// @notice A round operator was allowed or removed.
    event OperatorSet(address operator, bool allowed);
    /// @notice `amount` accrued fees moved to `router`.
    event FeesSwept(address indexed router, uint256 amount);
    /// @notice Swept fees now go to `router`.
    event FeeRouterSet(address router);
    /// @notice executeRound now checks operator bonds in `bonds`.
    event BondsSet(address bonds);

    error Conservation();
    error DepositsPaused();
    error BadAmount();
    error BadEntryState();
    error StandbyActive();
    error NotGuardian();
    error Expired();
    error BadSignature();
    error UnknownRoot();
    error NullifierSpent();
    error BadExtData();
    error InvalidProof();
    error NotATin();
    error SendBackLimit();
    error NotEnoughProviders();
    error RequestsPaused();
    error BadRound();
    error BadSize();
    error CommitUsed();
    error CannotClose();
    error NotOperator();
    error BadReveal();
    error NotSorted();
    error BadValue();
    error NotSettleable();
    error TooEarly();
    error BadSecret();
    error OutOfBounds();
    error EthTransfer();
    error OverCap();
    error ZeroAddress();
    error NothingExecuted();

    constructor(
        IUSDG usdg_,
        ScreeningGate gate_,
        Verifiers memory v,
        Hashers memory h,
        address owner_,
        address guardian_
    ) MerkleTree(h.t3) Ownable(owner_) EIP712("FoilStashPool", "1") {
        poseidonT4 = h.t4;
        usdg = usdg_;
        gate = gate_;
        joinsplitVerifier = v.joinsplit;
        tinRequestVerifier = v.tinRequest;
        ppoiVerifier = v.ppoi;
        guardian = guardian_;
        POOL_ID = uint256(keccak256(abi.encode(block.chainid, address(this)))) % FIELD;
        currentRound = 1;
    }

    /// Build §3.1: checked at the end of every state-changing function.
    modifier conserved() {
        _;
        if (usdg.balanceOf(address(this)) < totalIn - totalOut) revert Conservation();
    }

    // ------------------------------------------------------------------ entries

    /// @notice Deposit from an outside wallet (approve first). The note commitment is computed
    /// on-chain from the measured amount at admission (Build §3.1 amount binding).
    /// @param amount USDG to pull, ≥ $1 (the received amount is measured).
    /// @param npk Note public key, below the SNARK field.
    /// @param ciphertext Encrypted note for the owner's wallet (opaque to the pool).
    /// @param epk Ephemeral public key for `ciphertext`.
    /// @return seq Entry id.
    function deposit(uint256 amount, uint256 npk, bytes calldata ciphertext, bytes calldata epk)
        external
        nonReentrant
        conserved
        returns (uint256 seq)
    {
        if (depositsPaused) revert DepositsPaused();
        if (amount < MIN_DEPOSIT || amount >= MAX_AMOUNT || npk >= FIELD) revert BadAmount();
        uint256 gross = _pull(msg.sender, amount);
        if (gross < MIN_DEPOSIT) revert BadAmount();
        _checkCaps(gross);
        seq = _enqueue(msg.sender, EntryKind.Deposit, gross, _bpsCeil(gross, DEPOSIT_FEE_BPS), npk, ciphertext, epk);
    }

    /// @notice Send-back from a tin (Build §3.3). The tin signs an EIP-3009 authorization whose
    /// nonce binds the note and the expected fee, so a relayer can neither redirect it,
    /// replay it, nor reorder two send-backs into notes that differ from their ciphertext.
    /// The part up to what the tin was funded with is never paused or capped; any excess
    /// is new money and follows the deposit pause and caps. The tin needs no ETH.
    /// @param a The tin's EIP-3009 authorization to the pool; its nonce must be sendBackNonce(npk, fee,
    /// ciphertext, epk).
    /// @param fee 0.25% (rounded up) of the part above what the tin was funded with, else 0.
    /// @return seq Entry id.
    function returnToStash(Auth3009 calldata a, uint256 fee, uint256 npk, bytes calldata ciphertext, bytes calldata epk)
        external
        nonReentrant
        conserved
        returns (uint256 seq)
    {
        uint256 funded = tinFunded[a.from];
        if (funded == 0) revert NotATin();
        if (a.value < SEND_BACK_MIN || a.value >= MAX_AMOUNT || npk >= FIELD) revert BadAmount();
        if (tinSendBacks[a.from] >= SEND_BACK_MAX) revert SendBackLimit();

        bytes32 nonce = sendBackNonce(npk, fee, ciphertext, epk);
        uint256 before = usdg.balanceOf(address(this));
        usdg.receiveWithAuthorization(a.from, address(this), a.value, a.validAfter, a.validBefore, nonce, a.v, a.r, a.s);
        uint256 gross = usdg.balanceOf(address(this)) - before;
        // RHC USDG treats a reused authorization as a silent no-op (verified on a 4663
        // fork). Without this check a replay would create an empty entry and burn one of
        // the tin's send-back slots.
        if (gross != a.value) revert BadAmount();
        totalIn += gross;

        // Free up to what the tin was funded with (cumulative), 0.25% on the excess.
        uint256 sent = tinSentBack[a.from];
        uint256 freeLeft = funded > sent ? funded - sent : 0;
        if (gross > freeLeft) {
            if (depositsPaused) revert DepositsPaused();
            _checkCaps(gross - freeLeft);
        }
        if (fee != (gross > freeLeft ? _bpsCeil(gross - freeLeft, SEND_BACK_OVER_BPS) : 0)) revert BadAmount();
        tinSentBack[a.from] = sent + gross;
        tinSendBacks[a.from] += 1;

        seq = _enqueue(a.from, EntryKind.SendBack, gross, fee, npk, ciphertext, epk);
    }

    /// @notice EIP-3009 nonce for a send-back: binds the note, the expected fee, the pool and the chain.
    function sendBackNonce(uint256 npk, uint256 fee, bytes calldata ciphertext, bytes calldata epk) public view returns (bytes32) {
        return keccak256(abi.encode(npk, fee, keccak256(ciphertext), keccak256(epk), POOL_ID, block.chainid));
    }

    /// @notice Immediate admission with ≥ 2 provider signatures (clean deposit, or clean-inbound
    /// send-back: every USDG inbound to the tin came from the Stash or CC GachaVault).
    /// @param sigs EIP-191 signatures of admitDigest(seq) by ≥ 2 distinct active providers.
    function admitWithSignatures(uint256 seq, bytes[] calldata sigs) external nonReentrant conserved {
        gate.requireSignatures(admitDigest(seq), sigs);
        _admit(seq);
    }

    /// @notice Immediate admission of a deposit with one PPOI proof per fresh provider root, in
    /// gate.freshProviders() order. Requires ≥ 2 fresh providers. Send-backs are not
    /// eligible: a proof about the tin says nothing about who funded it.
    /// @param proofs PPOI non-membership proofs of the origin, one per fresh provider root.
    function admitWithProofs(uint256 seq, Proof[] calldata proofs) external nonReentrant conserved {
        if (entries[seq].kind != EntryKind.Deposit) revert BadEntryState();
        address[] memory fresh = gate.freshProviders();
        if (fresh.length < gate.MIN_SIGNATURES() || proofs.length != fresh.length) revert NotEnoughProviders();
        // Origins are public at entry, so the on-chain blind is 0.
        uint256 originHash = poseidonT3.hash([uint256(uint160(entries[seq].origin)), 0]);
        for (uint256 i = 0; i < fresh.length; i++) {
            (, uint256 root,) = gate.providers(fresh[i]);
            Proof calldata p = proofs[i];
            if (!ppoiVerifier.verifyProof(p.a, p.b, p.c, [root, originHash])) revert InvalidProof();
        }
        _admit(seq);
    }

    /// @notice After standby, anyone may admit an entry no provider flagged.
    function admitAfterStandby(uint256 seq) external nonReentrant conserved {
        if (block.timestamp < entries[seq].standbyEnds) revert StandbyActive();
        _admit(seq);
    }

    /// @notice A provider flags a pending entry; it never enters the tree.
    function flag(uint256 seq) external {
        if (!gate.isProvider(msg.sender)) revert ScreeningGate.NotProvider();
        Entry storage e = entries[seq];
        if (e.state != EntryState.Pending) revert BadEntryState();
        e.state = EntryState.Flagged;
        emit EntryFlagged(seq, msg.sender);
    }

    /// @notice Refund a pending or flagged entry to its origin, in full. Needs the origin's
    /// EIP-712 signature (EOA or ERC-1271); anyone may submit it, so a gasless tin can
    /// use it. Never paused.
    /// @param originSig The origin's EIP-712 ExitPending(seq, deadline) signature (see exitDigest).
    function exitPending(uint256 seq, uint256 deadline, bytes calldata originSig) external nonReentrant conserved {
        if (block.timestamp > deadline) revert Expired();
        Entry storage e = entries[seq];
        if (e.state != EntryState.Pending && e.state != EntryState.Flagged) revert BadEntryState();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(EXIT_TYPEHASH, seq, deadline)));
        if (!SignatureChecker.isValidSignatureNow(e.origin, digest, originSig)) revert BadSignature();
        e.state = EntryState.Refunded;
        pendingTotal -= e.gross;
        if (e.kind == EntryKind.SendBack) {
            tinSentBack[e.origin] -= e.gross;
            tinSendBacks[e.origin] -= 1;
        }
        _push(e.origin, e.gross);
        emit EntryRefunded(seq, e.origin, e.gross);
    }

    /// @notice Digest providers sign (EIP-191) to admit entry `seq`; binds chain, pool, origin, kind, amount and npk.
    function admitDigest(uint256 seq) public view returns (bytes32) {
        Entry storage e = entries[seq];
        return keccak256(abi.encode("foil-admit", block.chainid, address(this), seq, e.origin, e.kind, e.gross, e.npk));
    }

    /// @notice EIP-712 digest the origin signs for exitPending(seq, deadline).
    function exitDigest(uint256 seq, uint256 deadline) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(EXIT_TYPEHASH, seq, deadline)));
    }

    // ------------------------------------------------------------------ spends

    /// @notice 2×2 join-split: private transfer, or withdrawal to an outside wallet
    /// (0.25% protocol fee). Deposits never go through here; they use the queue.
    /// @param root A root the tree has had.
    /// @param nullifiers Nullifiers of the two input notes.
    /// @param outs The two output note commitments.
    /// @param ext Public data bound by extDataHash: recipient, extAmount (≤ 0), relayer, fee (≤ $5), encrypted
    /// outputs.
    function transact(Proof calldata p, uint256 root, uint256[2] calldata nullifiers, uint256[2] calldata outs, ExtData calldata ext)
        external
        nonReentrant
        conserved
    {
        if (ext.extAmount > 0 || ext.fee > MAX_RELAYER_FEE || uint256(-ext.extAmount) >= MAX_AMOUNT) revert BadExtData();
        _spend(root, nullifiers);
        uint256 out = uint256(-ext.extAmount);
        uint256 publicAmount = out + ext.fee == 0 ? 0 : FIELD - (out + ext.fee);
        uint256[9] memory pub =
            [root, publicAmount, extDataHash(ext), uint256(uint160(address(usdg))), POOL_ID, nullifiers[0], nullifiers[1], outs[0], outs[1]];
        if (!joinsplitVerifier.verifyProof(p.a, p.b, p.c, pub)) revert InvalidProof();

        _leaf(outs[0], ext.encryptedOutput1);
        _leaf(outs[1], ext.encryptedOutput2);

        if (out > 0) {
            if (ext.recipient == address(0)) revert BadExtData();
            uint256 protocolFee = _bpsCeil(out, WITHDRAW_FEE_BPS);
            feesAccrued += protocolFee;
            _push(ext.recipient, out - protocolFee);
            emit Withdrawal(ext.recipient, out - protocolFee, protocolFee);
        }
        if (ext.fee > 0) _push(ext.relayer == address(0) ? msg.sender : ext.relayer, ext.fee);
    }

    /// @notice Hash of `ext` bound into the join-split proof (pool-scoped, mod p).
    function extDataHash(ExtData calldata ext) public view returns (uint256) {
        return uint256(keccak256(abi.encode(POOL_ID, ext))) % FIELD;
    }

    // ------------------------------------------------------------------ funding rounds

    /// @notice Request a tin (or a refill of one): the proof spends notes, reserves size + fees
    /// for `roundId`, returns change, and fixes the refund note and cancel hash.
    /// @return reqIdx Index of the request in round `a.roundId`.
    function requestTin(Proof calldata p, TinRequestArgs calldata a) external nonReentrant conserved returns (uint256 reqIdx) {
        if (requestsPaused) revert RequestsPaused();
        if (a.roundId != currentRound) revert BadRound();
        if (!isTinSize(a.size)) revert BadSize();
        if (a.fee > MAX_RELAYER_FEE || a.tinCommit >= FIELD || a.refundCommit >= FIELD || a.cancelHash >= FIELD) revert BadExtData();
        if (requestOfCommit[a.tinCommit] != 0) revert CommitUsed();

        uint256 reserved = reservedFor(a.size);
        _spend(a.root, a.nullifiers);
        uint256[13] memory pub = [
            a.root, tinRequestDataHash(a.relayer, a.encryptedChange), uint256(uint160(address(usdg))), POOL_ID,
            a.nullifiers[0], a.nullifiers[1], a.changeCommitment, reserved, a.fee, a.roundId, a.tinCommit,
            a.refundCommit, a.cancelHash
        ];
        if (!tinRequestVerifier.verifyProof(p.a, p.b, p.c, pub)) revert InvalidProof();
        _leaf(a.changeCommitment, a.encryptedChange);

        Round storage r = rounds[a.roundId];
        if (r.count == 0) r.openedAt = uint64(block.timestamp);
        r.count += 1;
        reqIdx = _requests[a.roundId].length;
        _requests[a.roundId].push(
            Request({
                tinCommit: a.tinCommit,
                refundCommit: a.refundCommit,
                cancelHash: a.cancelHash,
                size: uint128(a.size),
                reserved: uint128(reserved),
                gasFee: uint128(gasFeeUsdg),
                state: RequestState.Pending
            })
        );
        requestOfCommit[a.tinCommit] = (a.roundId << 32) | (reqIdx + 1);
        reservedTotal += reserved;
        if (a.fee > 0) _push(a.relayer == address(0) ? msg.sender : a.relayer, a.fee);
        emit TinRequested(a.roundId, reqIdx, a.tinCommit, a.size);
    }

    /// @notice Hash of the relayer and change ciphertext bound into the tin-request proof.
    function tinRequestDataHash(address relayer, bytes calldata encryptedChange) public view returns (uint256) {
        return uint256(keccak256(abi.encode(POOL_ID, relayer, encryptedChange))) % FIELD;
    }

    /// @notice USDG a request of `size` reserves: size + 0.15% + $0.20 + the current gas fee.
    function reservedFor(uint256 size) public view returns (uint256) {
        return size + _bpsCeil(size, TIN_FEE_BPS) + TIN_FEE_FLAT + gasFeeUsdg;
    }

    /// @notice True for the 7 tin sizes ($10, 25, 50, 100, 250, 500, 1,000).
    function isTinSize(uint256 s) public pure returns (bool) {
        return s == 10e6 || s == 25e6 || s == 50e6 || s == 100e6 || s == 250e6 || s == 500e6 || s == 1000e6;
    }

    /// @notice Anyone may close the current round: within 2 min after a 10-minute boundary with
    /// ≥ 8 requests, or 30 minutes after its first request regardless. A new round opens.
    function closeRound() external {
        uint256 id = currentRound;
        Round storage r = rounds[id];
        if (!canClose(id)) revert CannotClose();
        r.closedAt = uint64(block.timestamp);
        currentRound = id + 1;
        emit RoundClosed(id, r.count);
    }

    /// @notice True if closeRound would close round `id` now.
    function canClose(uint256 id) public view returns (bool) {
        Round storage r = rounds[id];
        if (id != currentRound || r.count == 0) return false;
        if (block.timestamp >= r.openedAt + ROUND_MAX_WAIT) return true;
        uint256 firstBoundary = (uint256(r.openedAt) / ROUND_CADENCE + 1) * ROUND_CADENCE;
        return r.count >= ROUND_MIN_REQUESTS && block.timestamp >= firstBoundary
            && block.timestamp % ROUND_CADENCE < CLOSE_WINDOW;
    }

    /// @notice A bonded operator reveals (tin, salt) for the round's requests, sorted by tin
    /// address (a tin may repeat), and pays every tin its size in USDG plus ethPerTin.
    /// Cancelled or settled requests are skipped and their ETH returned; a tin that
    /// refuses USDG becomes Unfundable and one that refuses ETH keeps its USDG only, so
    /// no single tin can block a round. A round can be executed in several calls, but
    /// each call must fund at least one request.
    /// @dev msg.value must be ethPerTin × tins.length; ETH not delivered is returned to the caller.
    /// @param tins Revealed tin addresses, sorted ascending.
    /// @param salts The salt of each tin's commit.
    function executeRound(uint256 roundId, address[] calldata tins, bytes32[] calldata salts)
        external
        payable
        nonReentrant
        conserved
    {
        if (!operators[msg.sender] || !bonds.isBonded(msg.sender, 1)) revert NotOperator();
        Round storage r = rounds[roundId];
        if (r.closedAt == 0) revert BadRound();
        if (tins.length != salts.length || msg.value != ethPerTin * tins.length) revert BadValue();

        uint256 executed;
        uint256 gasOwed;
        uint256 ethBack = msg.value;
        for (uint256 i = 0; i < tins.length; i++) {
            if (i > 0 && tins[i] < tins[i - 1]) revert NotSorted();
            (Request storage q, uint256 idx) = _revealed(roundId, tins[i], salts[i]);
            if (q.state != RequestState.Pending) continue;
            if (!_tryFund(q, roundId, idx, tins[i], RequestState.Executed)) continue;
            gasOwed += q.gasFee;
            executed++;
            // Capped gas and no returndata copy: a tin can neither burn the round's gas nor
            // return a huge payload (memory expansion grows quadratically).
            address tin = tins[i];
            uint256 v = ethPerTin;
            bool ok;
            assembly ("memory-safe") {
                ok := call(50000, tin, v, 0, 0, 0, 0)
            }
            if (ok) ethBack -= ethPerTin;
        }
        if (executed == 0) revert NothingExecuted();
        if (r.executedAt == 0) {
            r.executedAt = uint64(block.timestamp);
            roundExecutor[roundId] = msg.sender;
        }
        if (gasOwed > 0) _push(msg.sender, gasOwed);
        if (ethBack > 0) _sendEth(msg.sender, ethBack);
        emit RoundExecuted(roundId, msg.sender, executed);
    }

    /// @notice Liveness (Build §3.2): 60 minutes after close, a still-pending request can be
    /// executed by anyone who knows (tin, salt). Nobody fronts ETH, so the unused gas fee
    /// goes to the tin in USDG, not to the caller. Never paused.
    function selfExecute(uint256 roundId, uint256 reqIdx, address tin, bytes32 salt) external nonReentrant conserved {
        Round storage r = rounds[roundId];
        if (r.closedAt == 0 || block.timestamp < r.closedAt + LIVENESS) revert TooEarly();
        if (reqIdx >= _requests[roundId].length) revert NotSettleable();
        Request storage q = _requests[roundId][reqIdx];
        if (tinCommitOf(tin, salt, q.size, roundId) != q.tinCommit) revert BadReveal();
        if (q.state != RequestState.Pending || !_tryFund(q, roundId, reqIdx, tin, RequestState.SelfExecuted)) revert NotSettleable();
        if (q.gasFee > 0) _push(tin, q.gasFee);
    }

    /// @notice The requester cancels a pending request with the secret only their device holds.
    /// The refund can only become refundCommit, which the proof fixed to their own note.
    /// @param cancelSecret Preimage of the request's cancelHash.
    function cancelRequest(uint256 roundId, uint256 reqIdx, bytes32 cancelSecret) external nonReentrant conserved {
        if (reqIdx >= _requests[roundId].length) revert NotSettleable();
        Request storage q = _requests[roundId][reqIdx];
        if (q.state != RequestState.Pending && q.state != RequestState.Unfundable) revert NotSettleable();
        if (uint256(keccak256(abi.encode(cancelSecret))) % FIELD != q.cancelHash) revert BadSecret();
        q.state = RequestState.Cancelled;
        reservedTotal -= q.reserved;
        uint32 leaf = _insert(q.refundCommit);
        emit NewCommitment(q.refundCommit, leaf, "");
        emit RequestCancelled(roundId, reqIdx, leaf);
    }

    /// @notice keccak(tin, salt, size, roundId) mod p: the commit a request fixes.
    function tinCommitOf(address tin, bytes32 salt, uint256 size, uint256 roundId) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(tin, salt, size, roundId))) % FIELD;
    }

    /// @notice Request `reqIdx` of round `roundId`.
    function getRequest(uint256 roundId, uint256 reqIdx) external view returns (Request memory) {
        return _requests[roundId][reqIdx];
    }

    /// @notice Number of requests in round `roundId`.
    function requestCount(uint256 roundId) external view returns (uint256) {
        return _requests[roundId].length;
    }

    /// @dev The request a (tin, salt) reveals. The commit binds (tin, salt, size, roundId),
    /// so each size is tried; a Pending match wins over a settled one, so a cancelled
    /// commit of another size cannot hide the real request.
    function _revealed(uint256 roundId, address tin, bytes32 salt) internal view returns (Request storage q, uint256 idx) {
        uint256[7] memory sizes = [uint256(10e6), 25e6, 50e6, 100e6, 250e6, 500e6, 1000e6];
        bool found;
        for (uint256 s = 0; s < sizes.length; s++) {
            uint256 ref = requestOfCommit[tinCommitOf(tin, salt, sizes[s], roundId)];
            if (ref == 0 || ref >> 32 != roundId) continue;
            uint256 i = (ref & type(uint32).max) - 1;
            if (_requests[roundId][i].state == RequestState.Pending) return (_requests[roundId][i], i);
            if (!found) (found, idx) = (true, i);
        }
        if (!found) revert BadReveal();
        q = _requests[roundId][idx];
    }

    /// @dev Pays the tin its size. If the tin refuses USDG (e.g. a blocklisted address or
    /// the pool itself) the request becomes Unfundable and nothing moves.
    function _tryFund(Request storage q, uint256 roundId, uint256 idx, address tin, RequestState how) internal returns (bool) {
        if (tin == address(this) || !_tryPush(tin, q.size)) {
            q.state = RequestState.Unfundable;
            return false;
        }
        q.state = how;
        reservedTotal -= q.reserved;
        feesAccrued += q.reserved - q.size - q.gasFee;
        tinFunded[tin] += q.size;
        emit TinFunded(roundId, idx, tin, q.size, how);
        return true;
    }

    function _sendEth(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert EthTransfer();
    }

    /// @notice Fees leave the pool only to the FeeRouter (Build §10). Anyone may trigger it.
    /// @return amount USDG sent to the FeeRouter.
    function sweepFees() external nonReentrant conserved returns (uint256 amount) {
        if (feeRouter == address(0)) revert OutOfBounds();
        amount = feesAccrued;
        feesAccrued = 0;
        if (amount > 0) _push(feeRouter, amount);
        emit FeesSwept(feeRouter, amount);
    }

    /// @notice Where swept fees go (owner, through the timelock). Must be a contract.
    function setFeeRouter(address r) external onlyOwner {
        if (r.code.length == 0) revert ZeroAddress();
        feeRouter = r;
        emit FeeRouterSet(r);
    }

    /// @notice The Bonds contract executeRound checks (owner, through the timelock).
    function setBonds(IOperatorBonds b) external onlyOwner {
        if (address(b).code.length == 0) revert ZeroAddress();
        bonds = b;
        emit BondsSet(address(b));
    }

    /// @notice Allow or remove a round operator. It must also hold an operator bond to execute.
    function setOperator(address op, bool allowed) external onlyOwner {
        if (op == address(0)) revert ZeroAddress();
        operators[op] = allowed;
        emit OperatorSet(op, allowed);
    }

    /// @notice Canary limits (Build §14: $1k per deposit, $500k in the pool for the first
    /// 30 days), owner through the timelock. 0 = no limit; each < 2^120 and maxDeposit ≤
    /// maxTotal. They bound new money only: send-backs up to the funded amount and every
    /// exit stay open.
    function setCaps(uint256 maxDeposit_, uint256 maxTotal_) external onlyOwner {
        if (maxDeposit_ >= MAX_AMOUNT || maxTotal_ >= MAX_AMOUNT || (maxTotal_ != 0 && maxDeposit_ > maxTotal_)) revert OutOfBounds();
        maxDeposit = maxDeposit_;
        maxTotal = maxTotal_;
        emit CapsSet(maxDeposit_, maxTotal_);
    }

    /// @notice Gas fee (≤ $5) and ETH per tin (≤ 0.005 ETH), owner through the timelock (Build §1).
    function setParams(uint256 gasFeeUsdg_, uint256 ethPerTin_) external onlyOwner {
        if (gasFeeUsdg_ > MAX_GAS_FEE || ethPerTin_ > MAX_ETH_PER_TIN) revert OutOfBounds();
        gasFeeUsdg = gasFeeUsdg_;
        ethPerTin = ethPerTin_;
        emit ParamsSet(gasFeeUsdg_, ethPerTin_);
    }

    // ------------------------------------------------------------------ guardian / owner

    /// @notice Guardian or owner sets the pause flags for deposits and tin requests. The guardian can only add
    /// pauses; only the owner unpauses. Exits (exitPending, transact, selfExecute, cancelRequest, send-backs up
    /// to the funded amount) are never paused.
    function pause(bool deposits_, bool requests_) external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        // The guardian can only pause; unpausing needs the owner (timelock).
        if (msg.sender == guardian && msg.sender != owner()) {
            deposits_ = deposits_ || depositsPaused;
            requests_ = requests_ || requestsPaused;
        }
        depositsPaused = deposits_;
        requestsPaused = requests_;
        emit Paused(deposits_, requests_);
    }

    /// @notice The pause-only guardian (owner, through the timelock).
    function setGuardian(address g) external onlyOwner {
        if (g == address(0)) revert ZeroAddress();
        guardian = g;
        emit GuardianSet(g);
    }

    // ------------------------------------------------------------------ internals

    function _enqueue(address origin, EntryKind kind, uint256 gross, uint256 fee, uint256 npk, bytes calldata ct, bytes calldata epk)
        internal
        returns (uint256 seq)
    {
        seq = nextSeq++;
        entries[seq] = Entry({
            origin: origin,
            kind: kind,
            state: EntryState.Pending,
            standbyEnds: uint64(block.timestamp + gate.standby()),
            gross: gross,
            fee: fee,
            npk: npk
        });
        pendingTotal += gross;
        emit EntryCreated(seq, kind, origin, gross, npk, ct, epk);
    }

    function _admit(uint256 seq) internal {
        Entry storage e = entries[seq];
        if (e.state != EntryState.Pending) revert BadEntryState();
        e.state = EntryState.Admitted;
        pendingTotal -= e.gross;
        feesAccrued += e.fee;
        uint256 commitment = poseidonT4.hash([uint256(uint160(address(usdg))), e.gross - e.fee, e.npk]);
        uint32 idx = _insert(commitment);
        emit EntryAdmitted(seq, commitment, idx);
    }

    function _spend(uint256 root, uint256[2] calldata nullifiers) internal {
        if (!isKnownRoot(root)) revert UnknownRoot();
        for (uint256 i = 0; i < 2; i++) {
            if (nullifierSpent[nullifiers[i]]) revert NullifierSpent();
            nullifierSpent[nullifiers[i]] = true;
            emit NewNullifier(nullifiers[i]);
        }
    }

    function _leaf(uint256 commitment, bytes calldata encryptedOutput) internal {
        if (commitment >= FIELD) revert BadExtData();
        uint32 idx = _insert(commitment);
        emit NewCommitment(commitment, idx, encryptedOutput);
    }

    function _pull(address from, uint256 amount) internal returns (uint256 received) {
        uint256 before = usdg.balanceOf(address(this));
        usdg.safeTransferFrom(from, address(this), amount);
        received = usdg.balanceOf(address(this)) - before;
        totalIn += received;
    }

    function _push(address to, uint256 amount) internal {
        totalOut += amount;
        usdg.safeTransfer(to, amount);
    }

    /// @dev Like _push, but returns false instead of reverting when the token refuses.
    function _tryPush(address to, uint256 amount) internal returns (bool) {
        (bool ok, bytes memory ret) = address(usdg).call(abi.encodeCall(usdg.transfer, (to, amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) return false;
        totalOut += amount;
        return true;
    }

    /// @dev Canary caps on new money, against the pool's accounted balance (a direct
    /// transfer to the pool cannot trip them).
    function _checkCaps(uint256 newMoney) internal view {
        if ((maxDeposit != 0 && newMoney > maxDeposit) || (maxTotal != 0 && totalIn - totalOut > maxTotal)) revert OverCap();
    }

    // Rounds up, so the pool never undercharges. Matches bpsCeil in packages/protocol.
    function _bpsCeil(uint256 amount, uint256 bps) internal pure returns (uint256) {
        return (amount * bps + 9_999) / 10_000;
    }
}
