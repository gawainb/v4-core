// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@pooltogether/owner-manager-contracts/contracts/Ownable.sol";
import "./interfaces/IDrawPrize.sol";
import "./interfaces/IDrawCalculator.sol";
import "./libraries/DrawLib.sol";

/**
  * @title  PoolTogether V4 DrawPrize
  * @author PoolTogether Inc Team
  * @notice The DrawPrize distributes claimable draw prizes to users via a pull model.
            Managing the regularly captured PrizePool interest, a DrawPrize is the
            entrypoint for users to submit Draw.drawId(s) and winning pick indices.
            Communicating with a DrawCalculator, the DrawPrize will determine the maximum
            prize payout and transfer those tokens directly to a user address. 
*/
contract DrawPrize is IDrawPrize, Ownable {
  using SafeERC20 for IERC20;

  /* ============ Global Variables ============ */

  /// @notice The Draw Calculator to use
  IDrawCalculator internal drawCalculator;
  
  /// @notice Token address
  IERC20          internal immutable token;

  /// @notice Maps users => drawId => paid out balance
  mapping(address => mapping(uint256 => uint256)) internal userDrawPayouts;

  /* ============ Initialize ============ */

  /**
    * @notice Initialize DrawPrize smart contract.
    * @param _owner           Address of the DrawPrize owner
    * @param _token           Token address
    * @param _drawCalculator DrawCalculator address
  */
  constructor(
    address _owner,
    IERC20 _token,
    IDrawCalculator _drawCalculator
  ) Ownable(_owner) {
    _setDrawCalculator(_drawCalculator);
    require(address(_token) != address(0), "DrawPrize/token-not-zero-address" );
    token = _token;
    emit TokenSet(_token);
  }

  /* ============ External Functions ============ */

  /// @inheritdoc IDrawPrize
  function claim(address _user, uint32[] calldata _drawIds, bytes calldata _data) external override returns (uint256) {
    uint256 totalPayout;
    uint256[] memory drawPayouts = drawCalculator.calculate(_user, _drawIds, _data);  // CALL
    for (uint256 payoutIndex = 0; payoutIndex < drawPayouts.length; payoutIndex++) {
      uint32 drawId = _drawIds[payoutIndex];
      uint256 payout = drawPayouts[payoutIndex];
      uint256 oldPayout = _getDrawPayoutBalanceOf(_user, drawId);
      uint256 payoutDiff = 0;
      if (payout > oldPayout) {
        payoutDiff = payout - oldPayout;
        _setDrawPayoutBalanceOf(_user, drawId, payout);
      }
      // helpfully short-circuit, in case the user screwed something up.
      require(payoutDiff > 0, "DrawPrize/zero-payout");
      totalPayout += payoutDiff;
      emit ClaimedDraw(_user, drawId, payoutDiff);
    }

    _awardPayout(_user, totalPayout);

    return totalPayout;
  }

  /// @inheritdoc IDrawPrize
  function getDrawCalculator() external override view returns (IDrawCalculator) {
    return drawCalculator;
  }

  /// @inheritdoc IDrawPrize
  function getDrawPayoutBalanceOf(address user, uint32 drawId) external override view returns (uint256) {
    return _getDrawPayoutBalanceOf(user, drawId);
  }

  /// @inheritdoc IDrawPrize
  function getToken() external override view returns (IERC20) {
    return token;
  }

  /// @inheritdoc IDrawPrize
  function setDrawCalculator(IDrawCalculator _newCalculator) external override onlyOwner returns (IDrawCalculator) {
    _setDrawCalculator(_newCalculator);
    return _newCalculator;
  }

  
  /* ============ Internal Functions ============ */

  function _getDrawPayoutBalanceOf(address _user, uint32 _drawId) internal view returns (uint256) {
    return userDrawPayouts[_user][_drawId];
  }

  function _setDrawPayoutBalanceOf(address _user, uint32 _drawId, uint256 _payout) internal {
    userDrawPayouts[_user][_drawId] = _payout;
  }

  /**
    * @notice Sets DrawCalculator reference for individual draw id.
    * @param _newCalculator  DrawCalculator address
  */
  function _setDrawCalculator(IDrawCalculator _newCalculator) internal {
    require(address(_newCalculator) != address(0), "DrawPrize/calc-not-zero");
    drawCalculator = _newCalculator;
    emit DrawCalculatorSet(_newCalculator);
  }

  /**
    * @notice Transfer claimed draw(s) total payout to user.
    * @param _to      User address
    * @param _amount  Transfer amount
  */
  function _awardPayout(address _to, uint256 _amount) internal {
    token.safeTransfer(_to, _amount);
  }

  /**
    * @notice Transfer ERC20 tokens out of this contract.
    * @dev    This function is only callable by the owner.
    * @param _erc20Token ERC20 token to transfer.
    * @param _to Recipient of the tokens.
    * @param _amount Amount of tokens to transfer.
    * @return true if operation is successful.
  */
  function withdrawERC20(IERC20 _erc20Token, address _to, uint256 _amount) external override onlyOwner returns (bool) {
    require(_to != address(0), "DrawPrize/recipient-not-zero-address");
    require(address(_erc20Token) != address(0), "DrawPrize/ERC20-not-zero-address");
    _erc20Token.safeTransfer(_to, _amount);
    emit ERC20Withdrawn(_erc20Token, _to, _amount);
    return true;
  }
}
