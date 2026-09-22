// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only payment token. No monetary value or USDG affiliation.
contract MockPaymentUSD is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 1_000 * 10 ** 6;
    mapping(address => uint256) public nextClaimAt;

    error UnsupportedChain();
    error FaucetCooldown(uint256 availableAt);

    constructor() ERC20("Demo USD", "DUSD") {
        if (block.chainid != 46630 && block.chainid != 31337) revert UnsupportedChain();
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function claim() external {
        if (block.timestamp < nextClaimAt[msg.sender]) revert FaucetCooldown(nextClaimAt[msg.sender]);
        nextClaimAt[msg.sender] = block.timestamp + 1 days;
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}
