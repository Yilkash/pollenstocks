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
} as const;
export const MAINNET_USDG = {
  symbol: "USDG",
  address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  decimals: 6,
} as const;
export type MainnetStock = keyof typeof MAINNET_ASSETS;
// Packed route internals are trusted to Kyber by user choice. Live execution remains
// gated by the environment flag and per-trade checks after funded-wallet preflight.
export const MAINNET_EXECUTION_READY = true;
