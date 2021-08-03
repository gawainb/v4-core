// SPDX-License-Identifier: MIT

pragma solidity 0.8.6;

import "../TsunamiDrawCalculator.sol";

import "hardhat/console.sol";

contract TsunamiDrawCalculatorHarness is TsunamiDrawCalculator {
  
   function getValueAtIndex(uint256 word, uint256 index, uint8 range, uint8 nibble) external view returns(uint256) {
    //  console.log("gasLeft 0", gasleft());
     return _getValueAtIndex(word, index, range, nibble);
   }

}
