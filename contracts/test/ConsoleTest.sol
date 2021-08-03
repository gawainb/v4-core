// SPDX-License-Identifier: MIT

pragma solidity 0.8.6;

import "hardhat/console.sol";

contract ConsoleTest {

    function testConsole() external {
        uint256 gas0 = gasleft();
        console.log("gas0: ", gas0);
        uint256 gas1 = gasleft();
        console.log("gas1: ", gas1);
        uint256 gas2 = gasleft();
        console.log("gas2: ", gas2);
    }

}