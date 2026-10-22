// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/// @title FoilStaking (Build §10): stakers receive 5% of fees and are first-loss behind
/// the round operators' ETH float.
///
/// - Stakes are shares of the staked $FOIL; rewards (USDG, streamed over 7 days) accrue
///   per earning share.
/// - First loss: the owner (24h TimelockController) can `cover` an operator float loss by
///   moving up to 30% of the staked $FOIL per call; every share loses value pro rata.
/// - Exits take a 7-day cooldown, longer than the 24h timelock, and must be withdrawn
///   within 2 days after it, so stakers cannot keep a ready exit open and leave when a
///   cover is queued. Shares in an exit request stay at risk but stop earning.
/// - While no share earns, the stream pauses: the idle time is added to periodFinish, so
///   no reward is stranded.
contract FoilStaking is Ownable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    IERC20 public immutable foil;
    IERC20 public immutable usdg;
    address public immutable notifier; // the FeeRouter
    uint256 public constant DURATION = 7 days;
    uint256 public constant COOLDOWN = 7 days;
    uint256 public constant EXIT_WINDOW = 2 days;
    /// A notify joins the running stream while at least this much of it is left.
    uint256 public constant MIN_STREAM_LEFT = 1 days;
    uint256 public constant MAX_COVER_BPS = 3_000;
    /// USDG has 6 decimals and FOIL 18: 1e18 scaling would truncate rewards per share.
    uint256 private constant SCALE = 1e30;

    uint256 public totalShares;
    uint256 public totalExiting; // shares in open exit requests (not earning)
    uint256 public totalFoil;
    mapping(address => uint256) public shares;
    mapping(address => uint256) public exitShares;
    mapping(address => uint64) public exitAt;

    uint256 public rewardRate; // USDG per second, scaled by SCALE
    uint256 public periodFinish;
    uint256 public lastUpdate;
    uint256 public rewardPerShareStored; // scaled by SCALE
    mapping(address => uint256) public paidPerShare;
    mapping(address => uint256) public rewards;

    /// @notice `who` staked `foil` $FOIL for `shares`.
    event Staked(address indexed who, uint256 foil, uint256 shares);
    /// @notice `who` has `shares` in an exit request, withdrawable from `at` for 2 days (0 = cancelled).
    event ExitRequested(address indexed who, uint256 shares, uint64 at);
    /// @notice `who` redeemed `shares` for `foil` $FOIL.
    event Withdrawn(address indexed who, uint256 foil, uint256 shares);
    /// @notice `who` claimed `amount` USDG.
    event RewardPaid(address indexed who, uint256 amount);
    /// @notice The FeeRouter added `amount` USDG to the 7-day stream.
    event RewardAdded(uint256 amount);
    /// @notice The owner moved `foil` staked $FOIL to `to` to cover an operator float loss.
    event LossCovered(address indexed to, uint256 foil, bytes32 reason);

    error NotNotifier();
    error ZeroAmount();
    error TooMuch();
    error Cooldown();
    error ExitExpired();

    constructor(IERC20 foil_, IERC20 usdg_, address notifier_, address owner_) Ownable(owner_) {
        foil = foil_;
        usdg = usdg_;
        notifier = notifier_;
    }

    modifier update(address who) {
        if (earningShares() == 0) {
            // Pause the stream: whatever was left at lastUpdate is still left now.
            periodFinish += block.timestamp - lastUpdate;
            lastUpdate = block.timestamp;
        } else {
            rewardPerShareStored = rewardPerShare();
            lastUpdate = lastApplicable();
        }
        if (who != address(0)) {
            rewards[who] = earned(who);
            paidPerShare[who] = rewardPerShareStored;
        }
        _;
    }

    /// @notice Shares that earn rewards: all shares minus those in exit requests.
    function earningShares() public view returns (uint256) {
        return totalShares - totalExiting;
    }

    /// @notice min(now, periodFinish): the last second rewards have accrued to.
    function lastApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    /// @notice Accumulated USDG per earning share, scaled by 1e30.
    function rewardPerShare() public view returns (uint256) {
        uint256 e = earningShares();
        if (e == 0) return rewardPerShareStored;
        return rewardPerShareStored + (lastApplicable() - lastUpdate) * rewardRate / e;
    }

    /// @notice USDG `who` can claim now.
    function earned(address who) public view returns (uint256) {
        return rewards[who] + (shares[who] - exitShares[who]) * (rewardPerShare() - paidPerShare[who]) / SCALE;
    }

    /// @notice $FOIL currently backing `who`'s shares (after any covered losses).
    function staked(address who) public view returns (uint256) {
        return totalShares == 0 ? 0 : shares[who] * totalFoil / totalShares;
    }

    /// @notice Stake `amount` $FOIL (approve first) for shares at the current rate.
    function stake(uint256 amount) external nonReentrant update(msg.sender) {
        if (amount == 0) revert ZeroAmount();
        uint256 s = totalShares == 0 || totalFoil == 0 ? amount : amount * totalShares / totalFoil;
        if (s == 0) revert ZeroAmount();
        totalShares += s;
        totalFoil += amount;
        shares[msg.sender] += s;
        foil.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount, s);
    }

    /// @notice Start the 7-day cooldown for `s` shares (replaces any earlier request; 0 cancels).
    /// Shares in the request stop earning until withdrawn or cancelled.
    /// @param s Shares to exit, ≤ the caller's shares; 0 cancels.
    function requestExit(uint256 s) external update(msg.sender) {
        if (s > shares[msg.sender]) revert TooMuch();
        totalExiting = totalExiting - exitShares[msg.sender] + s;
        exitShares[msg.sender] = s;
        exitAt[msg.sender] = s == 0 ? 0 : uint64(block.timestamp + COOLDOWN);
        emit ExitRequested(msg.sender, s, exitAt[msg.sender]);
    }

    /// @notice After the cooldown and within the 2-day window: shares → $FOIL at the current
    /// (post-loss) rate. A missed window needs a new request.
    function withdraw() external nonReentrant update(msg.sender) {
        uint256 s = exitShares[msg.sender];
        uint256 at = exitAt[msg.sender];
        if (s == 0 || block.timestamp < at) revert Cooldown();
        if (block.timestamp > at + EXIT_WINDOW) revert ExitExpired();
        uint256 amount = s * totalFoil / totalShares;
        exitShares[msg.sender] = 0;
        exitAt[msg.sender] = 0;
        totalExiting -= s;
        shares[msg.sender] -= s;
        totalShares -= s;
        totalFoil -= amount;
        foil.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount, s);
    }

    /// @notice Pay out the caller's accrued USDG.
    function claim() external nonReentrant update(msg.sender) {
        uint256 r = rewards[msg.sender];
        if (r == 0) return;
        rewards[msg.sender] = 0;
        usdg.safeTransfer(msg.sender, r);
        emit RewardPaid(msg.sender, r);
    }

    /// @notice First loss (Build §10): cover a round operator's ETH-float loss from staked $FOIL.
    /// Only through the 24h timelock; at most 30% of the stake per call.
    /// @param to Receiver of the $FOIL (whoever restores the operator float).
    /// @param reason Off-chain reference for the loss (incident id).
    function cover(address to, uint256 amount, bytes32 reason) external onlyOwner nonReentrant {
        if (amount == 0 || amount * 10_000 > totalFoil * MAX_COVER_BPS) revert TooMuch();
        totalFoil -= amount;
        foil.safeTransfer(to, amount);
        emit LossCovered(to, amount, reason);
    }

    /// @notice Pulls `amount` USDG from the FeeRouter. With a day or more of the stream left it
    /// joins that stream (same end); otherwise it starts a new 7-day stream with the leftover.
    /// @dev The FeeRouter (notifier) only.
    function notifyRewardAmount(uint256 amount) external update(address(0)) {
        if (msg.sender != notifier) revert NotNotifier();
        if (amount == 0) return;
        usdg.safeTransferFrom(msg.sender, address(this), amount);
        uint256 scaled = amount * SCALE;
        uint256 left = block.timestamp < periodFinish ? periodFinish - block.timestamp : 0;
        if (left >= MIN_STREAM_LEFT) {
            // Add to the running stream without extending it, so a new notify never slows
            // what current stakers are already due.
            rewardRate = (scaled + left * rewardRate) / left;
        } else {
            rewardRate = (scaled + left * rewardRate) / DURATION;
            periodFinish = block.timestamp + DURATION;
        }
        lastUpdate = block.timestamp;
        emit RewardAdded(amount);
    }
}
