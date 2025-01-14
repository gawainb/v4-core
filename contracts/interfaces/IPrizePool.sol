// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;
import "../external/compound/ICompLike.sol";
import "../interfaces/IControlledToken.sol";

interface IPrizePool {

  /// @dev Event emitted when controlled token is added
  event ControlledTokenAdded(
    IControlledToken indexed token
  );

  event AwardCaptured(
    uint256 amount
  );

  /// @dev Event emitted when assets are deposited
  event Deposited(
    address indexed operator,
    address indexed to,
    IControlledToken indexed token,
    uint256 amount
  );

  /// @dev Event emitted when interest is awarded to a winner
  event Awarded(
    address indexed winner,
    IControlledToken indexed token,
    uint256 amount
  );

  /// @dev Event emitted when external ERC20s are awarded to a winner
  event AwardedExternalERC20(
    address indexed winner,
    address indexed token,
    uint256 amount
  );

  /// @dev Event emitted when external ERC20s are transferred out
  event TransferredExternalERC20(
    address indexed to,
    address indexed token,
    uint256 amount
  );

  /// @dev Event emitted when external ERC721s are awarded to a winner
  event AwardedExternalERC721(
    address indexed winner,
    address indexed token,
    uint256[] tokenIds
  );

  /// @dev Event emitted when assets are withdrawn
  event Withdrawal(
    address indexed operator,
    address indexed from,
    IControlledToken indexed token,
    uint256 amount,
    uint256 redeemed
  );

  /// @dev Event emitted when the Balance Cap is set
  event BalanceCapSet(
    uint256 balanceCap
  );

  /// @dev Event emitted when the Liquidity Cap is set
  event LiquidityCapSet(
    uint256 liquidityCap
  );

  /// @dev Event emitted when the Prize Strategy is set
  event PrizeStrategySet(
    address indexed prizeStrategy
  );

  /// @dev Event emitted when the Ticket is set
  event TicketSet(
    IControlledToken indexed ticket
  );

  /// @dev Emitted when there was an error thrown awarding an External ERC721
  event ErrorAwardingExternalERC721(bytes error);

  /// @notice Deposit assets into the Prize Pool in exchange for tokens
  /// @param to The address receiving the newly minted tokens
  /// @param amount The amount of assets to deposit
  function depositTo(
    address to,
    uint256 amount
  )
    external;

  /// @notice Withdraw assets from the Prize Pool instantly.  A fairness fee may be charged for an early exit.
  /// @param from The address to redeem tokens from.
  /// @param amount The amount of tokens to redeem for assets.
  /// @return The actual amount withdrawn
  function withdrawFrom(
    address from,
    uint256 amount
  ) external returns (uint256);

  /// @notice Returns the balance that is available to award.
  /// @dev captureAwardBalance() should be called first
  /// @return The total amount of assets to be awarded for the current prize
  function awardBalance() external view returns (uint256);

  /// @notice Captures any available interest as award balance.
  /// @dev This function also captures the reserve fees.
  /// @return The total amount of assets to be awarded for the current prize
  function captureAwardBalance() external returns (uint256);

  /// @dev Checks with the Prize Pool if a specific token type may be awarded as an external prize
  /// @param _externalToken The address of the token to check
  /// @return True if the token may be awarded, false otherwise
  function canAwardExternal(address _externalToken) external view returns (bool);

  // @dev Returns the total underlying balance of all assets. This includes both principal and interest.
  /// @return The underlying balance of assets
  function balance() external returns (uint256);

  /// @dev Checks if a specific token is controlled by the Prize Pool
  /// @param _controlledToken The address of the token to check
  /// @return True if the token is a controlled token, false otherwise
  function isControlled(IControlledToken _controlledToken) external view returns (bool);

  /// @notice Called by the prize strategy to award prizes.
  /// @dev The amount awarded must be less than the awardBalance()
  /// @param to The address of the winner that receives the award
  /// @param amount The amount of assets to be awarded
  function award( address to, uint256 amount) external;

  /// @notice Called by the Prize-Strategy to transfer out external ERC20 tokens
  /// @dev Used to transfer out tokens held by the Prize Pool.  Could be liquidated, or anything.
  /// @param to The address of the winner that receives the award
  /// @param externalToken The address of the external asset token being awarded
  /// @param amount The amount of external assets to be awarded
  function transferExternalERC20(address to, address externalToken, uint256 amount) external;

  /// @notice Called by the Prize-Strategy to award external ERC20 prizes
  /// @dev Used to award any arbitrary tokens held by the Prize Pool
  /// @param to The address of the winner that receives the award
  /// @param amount The amount of external assets to be awarded
  /// @param externalToken The address of the external asset token being awarded
  function awardExternalERC20(
    address to, address externalToken, uint256 amount) external;

  /// @notice Called by the prize strategy to award external ERC721 prizes
  /// @dev Used to award any arbitrary NFTs held by the Prize Pool
  /// @param to The address of the winner that receives the award
  /// @param externalToken The address of the external NFT token being awarded
  /// @param tokenIds An array of NFT Token IDs to be transferred
  function awardExternalERC721(address to, address externalToken, uint256[] calldata tokenIds) external;

  /// @notice Allows the owner to set a balance cap per `token` for the pool.
  /// @dev If a user wins, his balance can go over the cap. He will be able to withdraw the excess but not deposit.
  /// @dev Needs to be called after deploying a prize pool to be able to deposit into it.
  /// @param _balanceCap New balance cap.
  /// @return True if new balance cap has been successfully set.
  function setBalanceCap(uint256 _balanceCap) external returns (bool);

  /// @notice Allows the Governor to set a cap on the amount of liquidity that he pool can hold
  /// @param _liquidityCap The new liquidity cap for the prize pool
  function setLiquidityCap(uint256 _liquidityCap) external;

  /// @notice Sets the prize strategy of the prize pool.  Only callable by the owner.
  /// @param _prizeStrategy The new prize strategy.  Must implement DrawPrizePrizeStrategy
  function setPrizeStrategy(address _prizeStrategy) external;

  /// @notice Set prize pool ticket.
  /// @param _ticket Address of the ticket to set.
  /// @return True if ticket has been successfully set.
  function setTicket(IControlledToken _ticket) external returns (bool);

  /// @dev Returns the address of the prize pool ticket.
  /// @return The address of the prize pool ticket.
  function ticket() external view returns (IControlledToken);
  
  /// @dev Returns the address of the prize pool ticket.
  /// @return The address of the prize pool ticket.
  function getTicket() external view returns (IControlledToken);

  /// @dev Returns the address of the underlying ERC20 asset
  /// @return The address of the asset
  function token() external view returns (address);

  /// @notice The total of all controlled tokens
  /// @return The current total of all tokens
  function accountedBalance() external view returns (uint256);

  /// @notice Delegate the votes for a Compound COMP-like token held by the prize pool
  /// @param _compLike The COMP-like token held by the prize pool that should be delegated
  /// @param _to The address to delegate to
  function compLikeDelegate(ICompLike _compLike, address _to) external;
}
