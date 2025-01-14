// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "@pooltogether/yield-source-interface/contracts/IYieldSource.sol";

import "./PrizePool.sol";

/**
  * @title  PoolTogether V4 YieldSourcePrizePool
  * @author PoolTogether Inc Team
  * @notice The Yield Source Prize Pool uses a yield source contract to generate prizes.
  *         Funds that are deposited into the prize pool are then deposited into a yield source. (i.e. Aave, Compound, etc...)
*/
contract YieldSourcePrizePool is PrizePool {

  using SafeERC20 for IERC20;
  using Address for address;

  /// @notice Address of the yield source.
  IYieldSource public yieldSource;

  /// @dev Emitted when yield source prize pool is deployed.
  /// @param yieldSource Address of the yield source.
  event Deployed(address indexed yieldSource);

  /// @notice Deploy the Prize Pool and Yield Service with the required contract connections
  /// @param _owner Address of the Yield Source Prize Pool owner
  /// @param _yieldSource Address of the yield source
  constructor (
    address _owner,
    IYieldSource _yieldSource
  ) PrizePool(_owner) {
    require(address(_yieldSource) != address(0), "YieldSourcePrizePool/yield-source-not-zero-address");

    yieldSource = _yieldSource;

    // A hack to determine whether it's an actual yield source
    (bool succeeded,) = address(_yieldSource).staticcall(abi.encodePacked(_yieldSource.depositToken.selector));
    require(succeeded, "YieldSourcePrizePool/invalid-yield-source");

    emit Deployed(address(_yieldSource));
  }

  /// @notice Determines whether the passed token can be transferred out as an external award.
  /// @dev Different yield sources will hold the deposits as another kind of token: such a Compound's cToken.  The
  /// prize strategy should not be allowed to move those tokens.
  /// @param _externalToken The address of the token to check
  /// @return True if the token may be awarded, false otherwise
  function _canAwardExternal(address _externalToken) internal override view returns (bool) {
    return _externalToken != address(yieldSource);
  }

  /// @notice Returns the total balance (in asset tokens).  This includes the deposits and interest.
  /// @return The underlying balance of asset tokens
  function _balance() internal override returns (uint256) {
    return yieldSource.balanceOfToken(address(this));
  }


  /// @notice Returns the address of the ERC20 asset token used for deposits.
  /// @return Address of the ERC20 asset token.
  function _token() internal override view returns (IERC20) {
    return IERC20(yieldSource.depositToken());
  }

  /// @notice Supplies asset tokens to the yield source.
  /// @param mintAmount The amount of asset tokens to be supplied
  function _supply(uint256 mintAmount) internal override {
    _token().safeApprove(address(yieldSource), mintAmount);
    yieldSource.supplyTokenTo(mintAmount, address(this));
  }

  /// @notice Redeems asset tokens from the yield source.
  /// @param redeemAmount The amount of yield-bearing tokens to be redeemed
  /// @return The actual amount of tokens that were redeemed.
  function _redeem(uint256 redeemAmount) internal override returns (uint256) {
    return yieldSource.redeemToken(redeemAmount);
  }
}
