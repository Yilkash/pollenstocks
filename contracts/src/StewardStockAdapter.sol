// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IHoodSwap {
    function usdg() external view returns (address);
    function swap(address stock, address tokenIn, uint256 amountIn, uint256 minAmountOut)
        external
        returns (uint256 amountOut);
}

/// @notice Testnet-only, caller-funded swaps. No administrator or arbitrary recipient.
/// @dev Adds deadline, replay protection, exact accounting and temporary pool allowance.
///      This does not make HoodSwap or the upgradeable token contracts trustless.
contract StewardStockAdapter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant EXCHANGE = 0x9b7f76c75cBAEd5801766cfA99DE15D198773dfe;
    address public constant USDG = 0x7E955252E15c84f5768B83c41a71F9eba181802F;
    bytes32 public constant EXCHANGE_CODEHASH = 0x5b526a6dd20402646bdde589247f0e0020a9827f8e5beeb601f14199bbea7f8c;
    uint256 public constant MAX_DEADLINE_WINDOW = 5 minutes;
    mapping(address => mapping(bytes32 => bool)) public usedOrders;

    error UnsupportedChain();
    error UnsupportedStock();
    error InvalidOrder();
    error DeadlineInvalid();
    error ExchangeChanged();
    error TokenAccountingMismatch();

    event TradeExecuted(
        bytes32 indexed orderId,
        address indexed trader,
        address indexed stock,
        bool buy,
        uint256 amountIn,
        uint256 amountOut
    );

    constructor() {
        if (block.chainid != 46630) revert UnsupportedChain();
        _checkExchange();
    }

    function supportedStock(address stock) public pure returns (bool) {
        return stock == 0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E
            || stock == 0x71178BAc73cBeb415514eB542a8995b82669778d || stock == 0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93
            || stock == 0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02;
    }

    function trade(bytes32 orderId, address stock, bool buy, uint256 amountIn, uint256 minAmountOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        if (block.chainid != 46630) revert UnsupportedChain();
        if (!supportedStock(stock)) revert UnsupportedStock();
        if (deadline < block.timestamp || deadline > block.timestamp + MAX_DEADLINE_WINDOW) revert DeadlineInvalid();
        if (
            orderId == bytes32(0) || usedOrders[msg.sender][orderId] || amountIn == 0
                || amountIn > (buy ? 1000 * 10 ** 6 : 1000 * 10 ** 18) || minAmountOut == 0
        ) revert InvalidOrder();
        _checkExchange();
        usedOrders[msg.sender][orderId] = true;
        IERC20 input = IERC20(buy ? USDG : stock);
        IERC20 output = IERC20(buy ? stock : USDG);
        uint256 inputBefore = input.balanceOf(address(this));
        uint256 callerInputBefore = input.balanceOf(msg.sender);
        uint256 outputBefore = output.balanceOf(address(this));
        uint256 callerOutputBefore = output.balanceOf(msg.sender);
        input.safeTransferFrom(msg.sender, address(this), amountIn);
        if (
            input.balanceOf(address(this)) != inputBefore + amountIn
                || input.balanceOf(msg.sender) + amountIn != callerInputBefore
        ) revert TokenAccountingMismatch();
        input.forceApprove(EXCHANGE, amountIn);
        uint256 reported = IHoodSwap(EXCHANGE).swap(stock, address(input), amountIn, minAmountOut);
        input.forceApprove(EXCHANGE, 0);
        amountOut = output.balanceOf(address(this)) - outputBefore;
        if (
            amountOut < minAmountOut || reported != amountOut || input.balanceOf(address(this)) != inputBefore
                || input.allowance(address(this), EXCHANGE) != 0
        ) revert TokenAccountingMismatch();
        output.safeTransfer(msg.sender, amountOut);
        if (
            output.balanceOf(msg.sender) != callerOutputBefore + amountOut
                || output.balanceOf(address(this)) != outputBefore
        ) revert TokenAccountingMismatch();
        emit TradeExecuted(orderId, msg.sender, stock, buy, amountIn, amountOut);
    }

    function _checkExchange() private view {
        if (EXCHANGE.codehash != EXCHANGE_CODEHASH || IHoodSwap(EXCHANGE).usdg() != USDG) revert ExchangeChanged();
    }
}
