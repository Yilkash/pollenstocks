import { defineChain } from "viem";

// Explicit per-network registries. No fallback from a mainnet asset to a test token.
export const robinhoodMainnet = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
  testnet: false,
});
export const MAINNET_ASSETS = {
  AAPL: { name: "Apple", address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", decimals: 18 },
  NVDA: { name: "NVIDIA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", decimals: 18 },
  TSLA: { name: "Tesla", address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", decimals: 18 },
  // Added 2026-09-28. Addresses and decimals match api.robinhood.com/rhj/assets, each has
  // a Chainlink "Robinhood <SYMBOL> / USD" feed, and KyberSwap quotes matched Robinhood's
  // token ask within ~0.1%. Selling one needs its Privy approve rule (see mainnet-policy).
  MSFT: { name: "Microsoft", address: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", decimals: 18 },
  GOOGL: { name: "Alphabet", address: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", decimals: 18 },
  AMZN: { name: "Amazon", address: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", decimals: 18 },
  META: { name: "Meta", address: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", decimals: 18 },
  SPY: {
    name: "S&P 500 ETF",
    address: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C",
    decimals: 18,
  },
  QQQ: {
    name: "Nasdaq-100 ETF",
    address: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68",
    decimals: 18,
  },
} as const;
export const MAINNET_USDG = {
  symbol: "USDG",
  address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  decimals: 6,
} as const;
export type MainnetStock = keyof typeof MAINNET_ASSETS;
export const MAINNET_STOCK_SYMBOLS = Object.keys(MAINNET_ASSETS) as [
  MainnetStock,
  ...MainnetStock[],
];
// Approve rules for these existed before the catalogue grew and are always required.
export const ORIGINAL_MAINNET_STOCKS: readonly MainnetStock[] = ["AAPL", "NVDA", "TSLA"];
// "Apple, NVIDIA, Tesla, ... or Nasdaq-100 ETF" for clarification questions.
export function mainnetStockChoices() {
  const names = MAINNET_STOCK_SYMBOLS.map((s) => MAINNET_ASSETS[s].name);
  return names.slice(0, -1).join(", ") + " or " + names[names.length - 1];
}
// Packed route internals are trusted to Kyber by user choice. Live execution remains
// gated by the environment flag and per-trade checks after funded-wallet preflight.
export const MAINNET_EXECUTION_READY = true;
