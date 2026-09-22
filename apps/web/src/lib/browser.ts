import { createWalletClient, custom, defineChain, type Address, type EIP1193Provider } from "viem";
import type { AppConfig } from "./shared";
export type BrowserProvider = EIP1193Provider & {
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};
declare global {
  interface Window {
    ethereum?: BrowserProvider;
  }
}
export async function api<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  const response = await fetch("/api/" + path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data as T;
}
export function walletClient(config: AppConfig) {
  if (!window.ethereum)
    throw new Error("Open this page in a wallet browser, or install an EVM wallet extension.");
  const chain = defineChain({
    id: config.chainId,
    name: config.chainName,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
    testnet: true,
    ...(config.explorer
      ? { blockExplorers: { default: { name: "Explorer", url: config.explorer } } }
      : {}),
  });
  return createWalletClient({ chain, transport: custom(window.ethereum) });
}
export async function assertWallet(config: AppConfig, expected: Address) {
  if (!window.ethereum) throw new Error("Wallet disconnected.");
  const [chain, accounts] = await Promise.all([
    window.ethereum.request({ method: "eth_chainId" }),
    window.ethereum.request({ method: "eth_accounts" }),
  ]);
  if (
    Number(chain) !== config.chainId ||
    (accounts as string[])[0]?.toLowerCase() !== expected.toLowerCase()
  )
    throw new Error("Wallet or network changed. Connect again before signing.");
}
export async function connectWallet(config: AppConfig) {
  const w = walletClient(config);
  const accounts = await w.requestAddresses();
  try {
    await w.switchChain({ id: config.chainId });
  } catch (e) {
    if (
      (e as { code?: number }).code !== 4902 &&
      (e as { cause?: { code?: number } }).cause?.code !== 4902
    )
      throw e;
    await w.addChain({ chain: w.chain });
    await w.switchChain({ id: config.chainId });
  }
  const account = accounts[0];
  if (!account) throw new Error("No wallet account selected.");
  await assertWallet(config, account);
  const challenge = await api<{ message: string }>("auth/challenge", { address: account });
  const signature = await w.signMessage({ account, message: challenge.message });
  await assertWallet(config, account);
  await api("auth/verify", { signature });
  return account;
}
export const short = (s: string) => s.slice(0, 6) + "…" + s.slice(-4);
