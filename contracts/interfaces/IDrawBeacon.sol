// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;

import "@pooltogether/pooltogether-rng-contracts/contracts/RNGInterface.sol";
import "./IDrawHistory.sol";
import "../libraries/DrawLib.sol";

interface IDrawBeacon {

  /**
    * @notice Emit when the DrawBeacon is initialized.
    * @param drawHistory Address of the draw history to push draws to
    * @param rng Address of RNG service
    * @param rngRequestPeriodStart Timestamp when draw period starts
    * @param drawPeriodSeconds Minimum seconds between draw period
  */
  event Initialized(
    IDrawHistory indexed drawHistory,
    RNGInterface indexed rng,
    uint256 rngRequestPeriodStart,
    uint256 drawPeriodSeconds
  );

  /**
    * @notice Emit when a new DrawHistory has been set.
    * @param previousDrawHistory  The previous DrawHistory address
    * @param newDrawHistory       The new DrawHistory address
  */
  event DrawHistoryTransferred(IDrawHistory indexed previousDrawHistory, IDrawHistory indexed newDrawHistory);

  /**
    * @notice Emit when a draw has opened.
    * @param operator             User address responsible for opening draw  
    * @param drawPeriodStartedAt  Epoch timestamp
  */
  event BeaconPeriodStarted(
    address indexed operator,
    uint256 indexed drawPeriodStartedAt
  );

  /**
    * @notice Emit when a draw has started.
    * @param operator      User address responsible for starting draw  
    * @param rngRequestId  draw id
    * @param rngLockBlock  Block when draw becomes invalid
  */
  event DrawStarted(
    address indexed operator,
    uint32 indexed rngRequestId,
    uint32 rngLockBlock
  );

  /**
    * @notice Emit when a draw has been cancelled.
    * @param operator      User address responsible for cancelling draw  
    * @param rngRequestId  draw id
    * @param rngLockBlock  Block when draw becomes invalid
  */
  event DrawCancelled(
    address indexed operator,
    uint32 indexed rngRequestId,
    uint32 rngLockBlock
  );
  
  /**
    * @notice Emit when a draw has been completed.
    * @param operator      User address responsible for completing draw  
    * @param randomNumber  Random number generated from draw
  */
  event DrawCompleted(
    address indexed operator,
    uint256 randomNumber
  );

  /**
    * @notice Emit when a RNG service address is set.
    * @param rngService  RNG service address
  */
  event RngServiceUpdated(
    RNGInterface indexed rngService
  );

  /**
    * @notice Emit when a draw timeout param is set.
    * @param rngTimeout  draw timeout param in seconds
  */
  event RngTimeoutSet(
    uint32 rngTimeout
  );

  /**
    * @notice Emit when the drawPeriodSeconds is set.
    * @param drawPeriodSeconds Time between draw
  */
  event BeaconPeriodSecondsUpdated(
    uint256 drawPeriodSeconds
  );

  function canStartDrawRequest() external view virtual returns (bool);
  function canCompleteDrawRequest() external view virtual returns (bool);
  function calculateNextBeaconPeriodStartTime(uint256 currentTime) external view virtual returns (uint256);
  function cancelDraw() external virtual;
  function completeDraw() external virtual;
  function beaconPeriodRemainingSeconds() external view virtual returns (uint256);
  function beaconPeriodEndAt() external view virtual returns (uint256);
  function getLastRngLockBlock() external view returns (uint32);
  function getLastRngRequestId() external view returns (uint32);
  function isBeaconPeriodOver() external view returns (bool);
  function isRngCompleted() external view returns (bool);
  function isRngRequested() external view returns (bool);
  function isRngTimedOut() external view returns (bool);
  function setBeaconPeriodSeconds(uint256 drawPeriodSeconds) external;
  function setRngTimeout(uint32 _rngTimeout) external;
  function setRngService(RNGInterface rngService) external;
  function startDraw() external virtual;
  function setDrawHistory(IDrawHistory newDrawHistory) external virtual returns (IDrawHistory);
}