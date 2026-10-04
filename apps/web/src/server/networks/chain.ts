import { defineChain } from "viem";

// Pollenstocks trades tokenized US stocks on Arc mainnet (chain 5042), Circle's L1 where USDC
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
/** Native gas amounts (18 decimals) to USDC ERC-20 units (6 decimals); same balance. */
export const NATIVE_PER_QUOTE_UNIT = 10n ** 12n;
/** Arc logs native USDC movements as ERC-20 Transfer events from this system address. */
export const NATIVE_TRANSFER_LOGGER = "0xfffffffffffffffffffffffffffffffffffffffe" as const;

// Stock tokens from ArcStocks (astock.fi). Each Arc token is minted only against the same
// Robinhood Chain stock token held in ArcStocks' vault there, so backing can be checked
// on-chain: Arc totalSupply must not exceed the vault's holdings (see stocks/backing.ts).
// Trades go through ArcStocks' desk on Arc: one transaction, USDC in, shares out.
// Checked 2026-10-04: these 8 are the stocks the desk trades; addresses from ArcStocks'
// published deployment, symbols "<TICKER>.arc", 18 decimals.
export const MAINNET_ASSETS = {
  NVDA: {
    name: "NVIDIA",
    address: "0x0A2dd7160De0c452ED4642d498162550Fe2165f2",
    underlying: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
    decimals: 18,
  },
  TSLA: {
    name: "Tesla",
    address: "0x349dcB3a576813FFbAB4B88547A0D694eb20EB18",
    underlying: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d",
    decimals: 18,
  },
  AAPL: {
    name: "Apple",
    address: "0xdC79A6e977Eb1668B6BFF7aC788053305ffF13C9",
    underlying: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
    decimals: 18,
  },
  AMZN: {
    name: "Amazon",
    address: "0x468B1D1f51c8EC186172C2386a0BED6Bcf99aDD8",
    underlying: "0x12f190a9F9d7D37a250758b26824B97CE941bF54",
    decimals: 18,
  },
  META: {
    name: "Meta",
    address: "0xEb88c032788bc9aDc4671C10C19b95F9B93A2E37",
    underlying: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35",
    decimals: 18,
  },
  GOOGL: {
    name: "Alphabet (Google)",
    address: "0x5606e025C05Dd41EA485b19490632E09F3ec03B8",
    underlying: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3",
    decimals: 18,
  },
  SPY: {
    name: "S&P 500 ETF",
    address: "0x8645EB2EF4D5A7c46212EB7688547442126c7b48",
    underlying: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C",
    decimals: 18,
  },
  QQQ: {
    name: "Nasdaq-100 ETF",
    address: "0xC2017F980b6b3f1D149541cF692c1971e53383D4",
    underlying: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68",
    decimals: 18,
  },
} as const;
/** On-chain ERC-20 symbol of an ArcStocks token. */
export const onchainSymbol = (symbol: string) => `${symbol}.arc`;

// ArcStocks desk on Arc: an ERC1967 proxy owned by ArcStocks. The proxy code, its
// implementation address and that code are pinned; an upgrade pauses trading until reviewed.
export const ARCSTOCKS_DESK = "0x3ac68fc2ad55599fa528fefa1f05cc1c1df26d69" as const;
export const ARCSTOCKS_DESK_CODEHASH =
  "0xcb3d8f7bd6dc20212c7ea858ffdc69d7f4ff6944af435c7f0a382f02e3458a62" as const;
export const ARCSTOCKS_DESK_IMPL = "0xc32c274c48a48e34872f8eea1bbbc0b3b6e43977" as const;
export const ARCSTOCKS_DESK_IMPL_CODEHASH =
  "0x313e232832aaa65b5deba640110291b324a192487753287614b1d696efc65287" as const;
// ArcStocks' vault on Robinhood Chain (4663), holding the stock tokens that back Arc supply.
export const ROBINHOOD_CHAIN_RPC = "https://rpc.mainnet.chain.robinhood.com";
export const ROBINHOOD_CHAIN_ID = 4663;
export const ARCSTOCKS_VAULT = "0xe77b3b55e75d8f5b484ce677fa9231f9181b1bcd" as const;
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
// "NVIDIA, Tesla, … or Nasdaq-100 ETF" for clarification questions.
export function mainnetStockChoices() {
  const names = MAINNET_STOCK_SYMBOLS.map((s) => MAINNET_ASSETS[s].name);
  return names.slice(0, -1).join(", ") + " or " + names[names.length - 1];
}
// Live execution remains gated by the environment flag and per-trade checks.
export const MAINNET_EXECUTION_READY = true;
