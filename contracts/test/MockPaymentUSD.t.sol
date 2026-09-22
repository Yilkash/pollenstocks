// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockPaymentUSD} from "../src/MockPaymentUSD.sol";

contract MockPaymentUSDTest is Test {
    MockPaymentUSD token;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        vm.chainId(31337);
        token = new MockPaymentUSD();
    }

    function testFaucetAndTransfer() public {
        vm.startPrank(alice);
        token.claim();
        assertEq(token.decimals(), 6);
        token.transfer(bob, 5_000_001);
        assertEq(token.balanceOf(bob), 5_000_001);
        assertEq(token.balanceOf(alice), 994_999_999);
        vm.stopPrank();
    }

    function testCooldownAndOtherWallet() public {
        vm.prank(alice);
        token.claim();
        vm.expectRevert(abi.encodeWithSelector(MockPaymentUSD.FaucetCooldown.selector, block.timestamp + 1 days));
        vm.prank(alice);
        token.claim();
        vm.prank(bob);
        token.claim();
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        token.claim();
        assertEq(token.balanceOf(alice), 2_000_000_000);
    }

    function testRejectsMainnetDeployment() public {
        vm.chainId(4663);
        vm.expectRevert(MockPaymentUSD.UnsupportedChain.selector);
        new MockPaymentUSD();
    }

    function testFuzzConservesBalance(uint256 amount) public {
        amount = bound(amount, 0, 1_000_000_000);
        vm.startPrank(alice);
        token.claim();
        token.transfer(bob, amount);
        vm.stopPrank();
        assertEq(token.balanceOf(alice) + token.balanceOf(bob), token.totalSupply());
    }
}
