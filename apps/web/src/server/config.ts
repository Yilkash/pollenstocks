import { defineChain } from "viem";
import { address, AppError, type AppConfig } from "@/lib/shared";

export function settings() {
  const chainId = Number(process.env.APP_CHAIN_ID || 46630);
  if (![46630, 31337].includes(chainId))
    throw new AppError("Only Robinhood Chain testnet and local development are enabled.", 503);
  const origin = new URL(process.env.APP_ORIGIN || "http://localhost:3000").origin;
  const rpc =
    process.env.RPC_URL ||
    (chainId === 31337 ? "http://127.0.0.1:8545" : "https://rpc.testnet.chain.robinhood.com");
  const token = process.env.DEMO_TOKEN_ADDRESS ? address(process.env.DEMO_TOKEN_ADDRESS) : null;
  const explorer = chainId === 46630 ? "https://explorer.testnet.chain.robinhood.com" : null;
  const name = chainId === 46630 ? "Robinhood Chain testnet" : "Local test chain";
  const chain = defineChain({
    id: chainId,
    name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
    ...(explorer ? { blockExplorers: { default: { name: "Explorer", url: explorer } } } : {}),
    testnet: true,
  });
  return { origin, rpc, token, chain, explorer };
}
export function publicConfig(): AppConfig {
  const s = settings();
  // Wallet setup uses public network endpoints, never the private provider URL.
  return {
    chainId: s.chain.id,
    chainName: s.chain.name,
    token: s.token,
    explorer: s.explorer,
    rpcUrl:
      s.chain.id === 31337 ? "http://127.0.0.1:8545" : "https://rpc.testnet.chain.robinhood.com",
    servReady: Boolean(process.env.SERV_API_KEY),
  };
}
