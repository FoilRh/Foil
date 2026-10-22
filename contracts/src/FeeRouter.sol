// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IRewardNotifier {
    /// @notice Pull `amount` USDG from the caller and stream it to stakers.
    function notifyRewardAmount(uint256 amount) external;
}

/// @title FeeRouter (Build §10): 80 / 10 / 5 / 5.
/// 80% to the work (relayers and round operators), 10% treasury, 5% stakers, 5% burned.
/// Fees arrive in USDG, so "burned" goes to `burnSink`: a buy-and-burn contract for
/// $FOIL (assumption: the Build does not say how USDG is burned; the sink is
/// owner-settable through the 24h timelock). Anyone may call distribute().
contract FeeRouter is Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant WORK_BPS = 8_000;
    uint256 public constant TREASURY_BPS = 1_000;
    uint256 public constant STAKERS_BPS = 500;
    // burn = remainder (500 bps), so rounding dust never stays here.
    /// Below this the call is a no-op, so dust cannot restart the stakers' 7-day stream.
    uint256 public constant MIN_DISTRIBUTE = 10e6;

    IERC20 public immutable usdg;
    address public work;
    address public treasury;
    IRewardNotifier public staking;
    address public burnSink;

    /// @notice One distribute(): `total` USDG split into the four legs.
    event Distributed(uint256 total, uint256 work, uint256 treasury, uint256 stakers, uint256 burn);
    /// @notice The four recipients changed.
    event RecipientsSet(address work, address treasury, address staking, address burnSink);

    error ZeroAddress();

    constructor(IERC20 usdg_, address owner_, address work_, address treasury_, IRewardNotifier staking_, address burnSink_)
        Ownable(owner_)
    {
        usdg = usdg_;
        _set(work_, treasury_, staking_, burnSink_);
    }

    /// @notice Change the four recipients (owner, through the timelock). None may be zero;
    /// staking must be a contract.
    function setRecipients(address work_, address treasury_, IRewardNotifier staking_, address burnSink_) external onlyOwner {
        _set(work_, treasury_, staking_, burnSink_);
    }

    /// @notice Split the USDG held here 80/10/5/5. Anyone may call; a no-op below $10.
    function distribute() external returns (uint256 total) {
        total = usdg.balanceOf(address(this));
        if (total < MIN_DISTRIBUTE) return 0;
        uint256 w = total * WORK_BPS / 10_000;
        uint256 t = total * TREASURY_BPS / 10_000;
        uint256 s = total * STAKERS_BPS / 10_000;
        uint256 b = total - w - t - s;
        usdg.safeTransfer(work, w);
        usdg.safeTransfer(treasury, t);
        usdg.forceApprove(address(staking), s);
        staking.notifyRewardAmount(s);
        usdg.safeTransfer(burnSink, b);
        emit Distributed(total, w, t, s, b);
    }

    function _set(address work_, address treasury_, IRewardNotifier staking_, address burnSink_) private {
        if (work_ == address(0) || treasury_ == address(0) || address(staking_).code.length == 0 || burnSink_ == address(0)) {
            revert ZeroAddress();
        }
        (work, treasury, staking, burnSink) = (work_, treasury_, staking_, burnSink_);
        emit RecipientsSet(work_, treasury_, address(staking_), burnSink_);
    }
}
