// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {StewardStockAdapter} from "../src/StewardStockAdapter.sol";
/// @dev Prepared deployment entry point. Not executed by application startup.

contract DeployStockAdapter is Script {
    function run() external returns (StewardStockAdapter adapter) {
        require(block.chainid == 46630, "Robinhood testnet only");
        vm.startBroadcast();
        adapter = new StewardStockAdapter();
        vm.stopBroadcast();
    }
}
