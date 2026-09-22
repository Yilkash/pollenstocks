"use client";
import { useEffect, useRef, useState } from "react";
import { type Address, type Hex, parseAbi } from "viem";
import { api, assertWallet, connectWallet, walletClient, isWalletRejection } from "@/lib/browser";
import {
  transferData,
  validateForSigning,
  type AppConfig,
  type Contact,
  type Payment,
} from "@/lib/shared";
type Message = { role: string; content: string; paymentId?: string | null };
/** Owns wallet/session state and payment actions; visual components only render it. */
export function usePaymentWorkspace() {
  const [config, setConfig] = useState<AppConfig | null>(null),
    [wallet, setWallet] = useState<Address | null>(null);
  const [balance, setBalance] = useState<{ eth: string; token: string | null } | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]),
    [payments, setPayments] = useState<Payment[]>([]);
  const [review, setReview] = useState<Payment | null>(null),
    [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [receive, setReceive] = useState(false),
    [recipient, setRecipient] = useState(""),
    [amount, setAmount] = useState("");
  const [note, setNote] = useState(""),
    [message, setMessage] = useState(""),
    [name, setName] = useState(""),
    [contactAddress, setContactAddress] = useState("");
  const [recovery, setRecovery] = useState("");
  const [initializing, setInitializing] = useState(true);
  const actionInFlight = useRef(false);
  const generation = useRef(0);
  function clearWalletView() {
    generation.current++;
    setWallet(null);
    setBalance(null);
    setContacts([]);
    setPayments([]);
    setReview(null);
    setMessages([]);
    setReceive(false);
    setRecovery("");
  }
  async function load() {
    const requestedGeneration = generation.current;
    const results = await Promise.allSettled([
      api<{ eth: string; token: string | null }>("balances"),
      api<Contact[]>("contacts"),
      api<Payment[]>("payments"),
      api<Message[]>("chat"),
    ]);
    if (requestedGeneration !== generation.current) return;
    if (results[0].status === "fulfilled") setBalance(results[0].value);
    else setError(results[0].reason.message);
    if (results[1].status === "fulfilled") setContacts(results[1].value);
    if (results[2].status === "fulfilled") setPayments(results[2].value);
    if (results[3].status === "fulfilled") setMessages(results[3].value);
  }
  async function run(fn: () => Promise<void>) {
    // React state updates are asynchronous; the ref closes the duplicate-click window.
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      actionInFlight.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const c = await api<AppConfig>("config");
        if (cancelled) return;
        setConfig(c);
        const session = await api<{ wallet: Address | null }>("session");
        if (cancelled) return;
        if (session.wallet) {
          // Extensions may inject their provider after React mounts. Wait without prompting.
          for (let i = 0; i < 15 && !window.ethereum && !cancelled; i++)
            await new Promise((resolve) => setTimeout(resolve, 100));
          if (cancelled) return;
          await assertWallet(c, session.wallet);
          if (cancelled) return;
          setWallet(session.wallet);
          await load();
        }
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Could not restore wallet session.");
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();
    return () => {
      cancelled = true;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    if (!wallet || !config) return;
    const provider = window.ethereum;
    const reset = () => {
      clearWalletView();
      // Do not delete the server session here: delayed events must not erase a new login.
      // Explicit disconnect still revokes it, and every signing action checks the wallet.
      setError("Wallet account or network changed. Reconnect to continue.");
    };
    const accountsChanged = (...args: unknown[]) => {
      const accounts = args[0];
      if (Array.isArray(accounts) && accounts[0]?.toLowerCase() === wallet.toLowerCase()) return;
      reset();
    };
    const chainChanged = (...args: unknown[]) => {
      if (Number(args[0]) === config.chainId) return;
      reset();
    };
    provider?.on?.("accountsChanged", accountsChanged);
    provider?.on?.("chainChanged", chainChanged);
    return () => {
      provider?.removeListener?.("accountsChanged", accountsChanged);
      provider?.removeListener?.("chainChanged", chainChanged);
    };
  }, [wallet, config]);
  const key = (p: Payment) =>
    "steward-hash:" + p.chainId + ":" + p.sender.toLowerCase() + ":" + p.id;
  async function send() {
    if (!config || !wallet || !review) return;
    const original = review;
    await assertWallet(config, wallet);
    // Claim before opening the wallet so another tab cannot sign this draft again.
    const p = await api<Payment>("payments/" + original.id + "/claim", {});
    setReview(p);
    let hash: Hex | undefined;
    let requested = false;
    try {
      validateForSigning(p, config, wallet);
      for (const field of [
        "recipient",
        "token",
        "sender",
        "amountBase",
        "chainId",
        "note",
      ] as const)
        if (p[field] !== original[field])
          throw new Error("Payment details changed. Signing stopped.");
      await assertWallet(config, wallet);
      requested = true;
      hash = await walletClient(config).sendTransaction({
        account: wallet,
        to: p.token,
        data: transferData(p),
        value: 0n,
        gas: BigInt(p.gas),
        gasPrice: BigInt(p.gasPrice),
        nonce: p.nonce!,
      });
      setRecovery(hash);
      // Keep the hash before the server request: broadcasting cannot be undone on timeout.
      try {
        localStorage.setItem(key(p), hash);
      } catch {
        /* The visible hash is also available for recovery. */
      }
      const updated = await api<Payment>("payments/" + p.id + "/submitted", { hash });
      setReview(updated);
      setNotice("Transaction submitted. Refresh its receipt to check inclusion.");
    } catch (e) {
      if (!hash) {
        // Only an explicit rejection is safe to release; ambiguous outcomes need recovery.
        const status = !requested || isWalletRejection(e) ? "rejected" : "unknown";
        try {
          setReview(await api<Payment>("payments/" + p.id + "/outcome", { status }));
        } catch {
          /* Reload recovers server state. */
        }
      }
      throw e;
    } finally {
      await load();
    }
  }
  async function select(p: Payment) {
    setReview(p);
    try {
      setRecovery(localStorage.getItem(key(p)) || p.hash || "");
    } catch {
      setRecovery(p.hash || "");
    }
  }

  async function toggleWallet() {
    if (wallet) {
      await api("session", undefined, "DELETE");
      clearWalletView();
    } else {
      setWallet(await connectWallet(config!));
      await load();
    }
  }

  async function preparePayment() {
    const p = await api<Payment>("payments", {
      recipient,
      amount,
      note,
      requestId: crypto.randomUUID(),
    });
    setReview(p);
    setRecovery("");
    await load();
  }

  async function sendMessage() {
    const result = await api<{ answer: string; draft: Payment | null }>("chat", { message });
    setMessage("");
    if (result.draft) {
      setReview(result.draft);
      setRecovery("");
    }
    await load();
  }

  async function recoverPayment() {
    if (!review) return;
    setReview(await api<Payment>("payments/" + review.id + "/submitted", { hash: recovery }));
    await load();
  }

  async function refreshReceipt() {
    if (!review) return;
    setReview(await api<Payment>("payments/" + review.id + "/refresh", {}));
    await load();
  }

  async function copyAddress() {
    if (!wallet) return;
    await navigator.clipboard.writeText(wallet);
    setNotice("Wallet address copied.");
  }

  async function saveContact() {
    await api("contacts", { name, address: contactAddress });
    setName("");
    setContactAddress("");
    await load();
  }

  async function claimTokens() {
    await assertWallet(config!, wallet!);
    const hash = await walletClient(config!).writeContract({
      account: wallet!,
      address: config!.token!,
      abi: parseAbi(["function claim()"]),
      functionName: "claim",
    });
    setNotice("Faucet request submitted: " + hash + ". Refresh your balance after it is included.");
  }

  async function removeContact(name: string) {
    await api("contacts", { name }, "DELETE");
    await load();
  }
  return {
    config,
    wallet,
    balance,
    contacts,
    payments,
    review,
    messages,
    busy,
    initializing,
    error,
    notice,
    receive,
    recipient,
    amount,
    note,
    message,
    name,
    contactAddress,
    recovery,
    setReceive,
    setRecipient,
    setAmount,
    setNote,
    setMessage,
    setName,
    setContactAddress,
    setRecovery,
    run,
    load,
    send,
    select,
    toggleWallet,
    preparePayment,
    sendMessage,
    recoverPayment,
    refreshReceipt,
    copyAddress,
    saveContact,
    claimTokens,
    removeContact,
  };
}
export type PaymentWorkspace = ReturnType<typeof usePaymentWorkspace>;
