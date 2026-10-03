import { defineChain } from "viem";

// Pollenstock trades tokenized US stocks on Arc mainnet (chain 5042), Circle's L1 where USDC
// is also the gas token. The native balance uses 18 decimals; the USDC ERC-20 interface at
// 0x3600… reads the same balance with 6 decimals.
export const mainnetChain = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.arc.io" } },
  testnet: false,
});
export const MAINNET_CHAIN_ID = 5042;
export const MAINNET_CAIP2 = "eip155:5042";
export const MAINNET_NETWORK_NAME = "Arc";
export const MAINNET_NATIVE_SYMBOL = "USDC";
export const MAINNET_EXPLORER_TX = "https://explorer.arc.io/tx/";
export const KYBER_CHAIN_SLUG = "arc";
/** Native gas amounts (18 decimals) to USDC ERC-20 units (6 decimals); same balance. */
export const NATIVE_PER_QUOTE_UNIT = 10n ** 12n;

// Stock tokens on Arc ("<Company> • Arc Token"), all issued by one owner and described by
// the issuer as backed 1:1 by Robinhood Chain stock tokens. Pinned by address: copycat
// tokens with the same name and symbol exist on Arc (e.g. a second CRCL with no sell route).
// Checked 2026-10-04: code present, 18 decimals, buy and sell routes via KyberSwap within
// ~2% of Robinhood's bid/ask. SPY is excluded: its pool is too thin to sell fairly.
export const STOCK_ISSUER_OWNER = "0xb053c334d151374fc19f784ebd543b73701ddfd8" as const;
export const MAINNET_ASSETS = {
  NVDA: { name: "NVIDIA", address: "0x6505506540dC99f7366316B10E9CF1A584cbD42a", decimals: 18 },
  CRCL: { name: "Circle", address: "0x2ba0f44BDfC17FbA30edA9cdBeCB908cA45B043B", decimals: 18 },
  GME: { name: "GameStop", address: "0x41B386E03928c70D635606C210717C19DCfC984d", decimals: 18 },
  AMC: { name: "AMC", address: "0x0056eD10eA5a504a2Cc9BeC93aA5Fa8258bBa0C7", decimals: 18 },
} as const;
export const MAINNET_QUOTE = {
  symbol: "USDC",
  address: "0x3600000000000000000000000000000000000000",
  decimals: 6,
} as const;
export type MainnetStock = keyof typeof MAINNET_ASSETS;
export const MAINNET_STOCK_SYMBOLS = Object.keys(MAINNET_ASSETS) as [
  MainnetStock,
  ...MainnetStock[],
];
// "NVIDIA, Circle, GameStop or AMC" for clarification questions.
export function mainnetStockChoices() {
  const names = MAINNET_STOCK_SYMBOLS.map((s) => MAINNET_ASSETS[s].name);
  return names.slice(0, -1).join(", ") + " or " + names[names.length - 1];
}
// Packed route internals are trusted to Kyber by user choice. Live execution remains
// gated by the environment flag and per-trade checks after funded-wallet preflight.
export const MAINNET_EXECUTION_READY = true;
