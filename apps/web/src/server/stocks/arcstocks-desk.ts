import { keccak256, parseAbi, type Address, type PublicClient } from "viem";
import {
  ARCSTOCKS_DESK,
  ARCSTOCKS_DESK_CODEHASH,
  ARCSTOCKS_DESK_IMPL,
  ARCSTOCKS_DESK_IMPL_CODEHASH,
  MAINNET_ASSETS,
  NATIVE_PER_QUOTE_UNIT,
  type MainnetStock,
} from "../networks/chain";

// ArcStocks desk on Arc. A buy sends USDC as the transaction value (18-decimal native units)
// and receives the stock token in the same transaction; a sell needs an exact approval first.
export const deskAbi = parseAbi([
  "function buy(address stock,uint256 minSharesOut,address to) payable returns (uint256 sharesOut)",
  "function sell(address stock,uint256 sharesIn,uint256 minUsdcOut,address to) returns (uint256 usdcOut)",
  "function quoteBuy(address stock,uint256 usdcIn) view returns (uint256 sharesOut,bool ok)",
  "function quoteSell(address stock,uint256 sharesIn) view returns (uint256 usdcOut,bool ok)",
  "function paused() view returns (bool)",
  "event Bought(address indexed stock,address indexed buyer,address to,uint256 usdcIn,uint256 sharesOut,uint256 price)",
  "event Sold(address indexed stock,address indexed seller,address to,uint256 sharesIn,uint256 usdcOut,uint256 price)",
]);
/** ERC1967 implementation slot: keccak256("eip1967.proxy.implementation") - 1. */
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

export class DeskError extends Error {
  constructor(
    public readonly code:
      | "desk_changed"
      | "desk_paused"
      | "desk_unavailable"
      | "desk_cannot_fill"
      | "invalid_amount",
  ) {
    super(code);
  }
}

/** Refuse to trade if ArcStocks upgraded or paused the desk since it was reviewed. */
export async function checkDesk(client: PublicClient) {
  let proxyCode, implSlot, implCode, paused;
  try {
    [proxyCode, implSlot, implCode, paused] = await Promise.all([
      client.getCode({ address: ARCSTOCKS_DESK }),
      client.getStorageAt({ address: ARCSTOCKS_DESK, slot: IMPLEMENTATION_SLOT }),
      client.getCode({ address: ARCSTOCKS_DESK_IMPL }),
      client.readContract({ address: ARCSTOCKS_DESK, abi: deskAbi, functionName: "paused" }),
    ]);
  } catch {
    throw new DeskError("desk_unavailable");
  }
  const impl = implSlot ? `0x${implSlot.slice(-40)}` : "";
  if (
    !proxyCode ||
    !implCode ||
    keccak256(proxyCode) !== ARCSTOCKS_DESK_CODEHASH ||
    impl.toLowerCase() !== ARCSTOCKS_DESK_IMPL ||
    keccak256(implCode) !== ARCSTOCKS_DESK_IMPL_CODEHASH
  )
    throw new DeskError("desk_changed");
  if (paused) throw new DeskError("desk_paused");
}

export type DeskQuote = {
  /** Stock tokens out for a buy (18 decimals); USDC out for a sell (6 decimals, rounded down). */
  amountOut: bigint;
};
/**
 * Quote from the desk contract itself. `amountIn` is USDC in 6 decimals for a buy and stock
 * tokens in 18 decimals for a sell. `ok` false means the desk cannot fill this size now.
 */
export async function deskQuote(
  client: PublicClient,
  symbol: MainnetStock,
  side: "buy" | "sell",
  amountIn: bigint,
): Promise<DeskQuote> {
  if (amountIn <= 0n) throw new DeskError("invalid_amount");
  const stock: Address = MAINNET_ASSETS[symbol].address;
  let result: readonly [bigint, boolean];
  try {
    result =
      side === "buy"
        ? await client.readContract({
            address: ARCSTOCKS_DESK,
            abi: deskAbi,
            functionName: "quoteBuy",
            args: [stock, amountIn * NATIVE_PER_QUOTE_UNIT],
          })
        : await client.readContract({
            address: ARCSTOCKS_DESK,
            abi: deskAbi,
            functionName: "quoteSell",
            args: [stock, amountIn],
          });
  } catch {
    throw new DeskError("desk_unavailable");
  }
  const [out, ok] = result;
  if (!ok || out <= 0n) throw new DeskError("desk_cannot_fill");
  const amountOut = side === "buy" ? out : out / NATIVE_PER_QUOTE_UNIT;
  if (amountOut <= 0n) throw new DeskError("desk_cannot_fill");
  return { amountOut };
}
