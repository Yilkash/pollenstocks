"use client";
import { useEffect, useRef, useState } from "react";
import { createPublicClient, http, formatEther, type Address, type Hex } from "viem";
import { assertWallet, walletClient } from "@/lib/browser";
import type { AppConfig } from "@/lib/shared";
import token from "@/generated/payment-token.json";

const config: AppConfig = {
  chainId: 46630,
  chainName: "Robinhood Chain testnet",
  token: null,
  explorer: "https://explorer.testnet.chain.robinhood.com",
  rpcUrl: "https://rpc.testnet.chain.robinhood.com",
  servReady: false,
};
const storageKey = "steward-deployment:46630";
type Attempt = { sender: Address; hash: Hex | null };
export default function Deploy() {
  const [account, setAccount] = useState<Address | null>(null),
    [fee, setFee] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null),
    [hash, setHash] = useState(""),
    [contract, setContract] = useState<Address | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const working = useRef(false);
  const rpc = () =>
    createPublicClient({ transport: http(config.rpcUrl, { retryCount: 1, timeout: 15000 }) });
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const a = JSON.parse(saved) as Attempt;
        setAttempt(a);
        setHash(a.hash || "");
      }
    } catch {
      setError(
        "Deployment recovery storage is unavailable. Enable browser storage before deploying.",
      );
    }
  }, []);
  async function run(fn: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function prepare() {
    const w = walletClient(config);
    const [sender] = await w.requestAddresses();
    try {
      await w.switchChain({ id: 46630 });
    } catch (e) {
      const err = e as { code?: number; cause?: { code?: number } };
      if (err.code !== 4902 && err.cause?.code !== 4902) throw e;
      await w.addChain({ chain: w.chain });
      await w.switchChain({ id: 46630 });
    }
    const expected = new URLSearchParams(window.location.search).get("wallet");
    if (expected && expected.toLowerCase() !== sender?.toLowerCase())
      throw new Error("Select the funded wallet shown in the link.");
    await assertWallet(config, sender);
    const c = rpc();
    if ((await c.getChainId()) !== 46630) throw new Error("Unexpected RPC network.");
    const gas = await c.estimateGas({ account: sender, data: token.bytecode as Hex });
    const price = await c.getGasPrice();
    const estimate = ((gas * 120n) / 100n) * price;
    if ((await c.getBalance({ address: sender })) < estimate)
      throw new Error("Insufficient test ETH for deployment.");
    setAccount(sender);
    setFee(formatEther(estimate));
    setStatus("Review the deployment below. Your wallet will show the final fee.");
  }
  async function deploy() {
    if (!account || !fee || attempt) return;
    await assertWallet(config, account);
    // Persist before asking the wallet so a reload never silently offers a duplicate deployment.
    const pending: Attempt = { sender: account, hash: null };
    localStorage.setItem(storageKey, JSON.stringify(pending));
    setAttempt(pending);
    try {
      const txHash = await walletClient(config).deployContract({
        account,
        abi: [],
        bytecode: token.bytecode as Hex,
      });
      const sent = { sender: account, hash: txHash };
      setAttempt(sent);
      setHash(txHash);
      setStatus("Deployment submitted. Save this hash and check the receipt.");
      localStorage.setItem(storageKey, JSON.stringify(sent));
    } catch (e) {
      const err = e as { code?: number; cause?: { code?: number } };
      if (err.code === 4001 || err.cause?.code === 4001) {
        localStorage.removeItem(storageKey);
        setAttempt(null);
      } else
        setStatus(
          "The wallet outcome is uncertain. Check wallet activity and recover the transaction hash before any retry.",
        );
      throw e;
    }
  }
  async function receipt() {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Enter a valid transaction hash.");
    const c = rpc();
    if ((await c.getChainId()) !== 46630) throw new Error("Unexpected RPC network.");
    const tx = await c.getTransaction({ hash: hash as Hex });
    const sender = attempt?.sender || account;
    if (!sender) throw new Error("Connect the deploying wallet first.");
    if (
      tx.to !== null ||
      tx.from.toLowerCase() !== sender.toLowerCase() ||
      tx.input.toLowerCase() !== token.bytecode.toLowerCase() ||
      tx.value !== 0n
    )
      throw new Error("This is not the expected token deployment from your wallet.");
    const r = await c.getTransactionReceipt({ hash: hash as Hex });
    if (r.status !== "success" || !r.contractAddress)
      throw new Error("Deployment failed. No token address was confirmed.");
    const code = await c.getCode({ address: r.contractAddress });
    if (code?.toLowerCase() !== token.deployedBytecode.toLowerCase())
      throw new Error("Deployed code does not match the compiled token.");
    setContract(r.contractAddress);
    setStatus(
      "Deployment included and contract code verified. Send this contract address back so the payment app can be configured.",
    );
    const confirmed = { sender, hash: hash as Hex };
    localStorage.setItem(storageKey, JSON.stringify(confirmed));
    setAttempt(confirmed);
  }
  return (
    <div style={{ maxWidth: 760, margin: "40px auto", padding: 20 }}>
      <a href="/">← Steward Pay</a>
      <div className="page-heading">
        <div className="eyebrow">ROBINHOOD CHAIN TESTNET · 46630</div>
        <h1>Deploy Demo USD</h1>
        <p>Create our test payment token using your wallet.</p>
      </div>
      <div className="test-banner">
        <span>TESTNET</span>No monetary value. Deployment spends test ETH.
      </div>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {status && (
        <div className="notice" role="status">
          {status}
        </div>
      )}
      <section className="card">
        <h2>Deployment details</h2>
        <dl>
          <dt>Token</dt>
          <dd>Demo USD (DUSD), 6 decimals</dd>
          <dt>Faucet</dt>
          <dd>1,000 DUSD per wallet every 24 hours</dd>
          <dt>Network</dt>
          <dd>Robinhood Chain testnet (46630)</dd>
          <dt>ETH sent</dt>
          <dd>0 ETH — network fee only</dd>
          <dt>Deployer</dt>
          <dd>
            <code>{account || attempt?.sender || "Connect your funded wallet"}</code>
          </dd>
          <dt>Estimated fee</dt>
          <dd>{fee ? fee + " test ETH" : "Calculate after connecting"}</dd>
        </dl>
        {!attempt && (
          <>
            <button disabled={busy} onClick={() => void run(prepare)}>
              Connect wallet & estimate fee
            </button>
            <button
              className="primary full"
              disabled={busy || !account || !fee}
              onClick={() => void run(deploy)}
            >
              Deploy — approve in wallet
            </button>
          </>
        )}
        <p className="small" style={{ marginTop: 16 }}>
          Your wallet signs the deployment. This page never asks for a private key. The fee estimate
          can change before signing.
        </p>
      </section>
      <section className="card" style={{ marginTop: 20 }}>
        <h2>Deployment receipt</h2>
        <p className="muted">
          Already submitted? Paste the hash from wallet activity and check its receipt. If it is
          still pending, wait and check again.
        </p>
        <input
          aria-label="Deployment transaction hash"
          placeholder="0x transaction hash"
          value={hash}
          onChange={(e) => setHash(e.target.value)}
        />
        {!attempt && !account && (
          <button disabled={busy} onClick={() => void run(prepare)}>
            Connect deploying wallet
          </button>
        )}
        <button className="full" disabled={busy || !hash} onClick={() => void run(receipt)}>
          Check deployment receipt
        </button>
        {contract && (
          <div className="notice" style={{ marginTop: 20 }}>
            <strong>Demo USD contract address</strong>
            <code style={{ display: "block", margin: "12px 0" }}>{contract}</code>
            <a href={config.explorer + "/address/" + contract} target="_blank" rel="noreferrer">
              View contract ↗
            </a>
          </div>
        )}
      </section>
      {busy && (
        <p role="status" style={{ marginTop: 20 }}>
          Working… Check your wallet for any approval request.
        </p>
      )}
    </div>
  );
}
