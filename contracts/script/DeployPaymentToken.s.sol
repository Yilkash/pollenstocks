// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {MockPaymentUSD} from "../src/MockPaymentUSD.sol";

contract DeployPaymentToken is Script {
    function run() external returns (MockPaymentUSD token) {
        vm.startBroadcast();
        token = new MockPaymentUSD();
        vm.stopBroadcast();
    }
}
