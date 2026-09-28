"use client";
import { Wallet, ShieldCheck } from "lucide-react";
import { short } from "@/lib/browser";
import { usePaymentWorkspace } from "@/hooks/use-payment-workspace";
import { BalanceCard } from "@/components/payments/balance-card";
import { PaymentForm } from "@/components/payments/payment-form";
import { AssistantChat } from "@/components/payments/assistant-chat";
import { PaymentReview } from "@/components/payments/payment-review";
import { ReceiveCard } from "@/components/payments/receive-card";
import { PaymentActivity } from "@/components/payments/payment-activity";
import { ContactsCard } from "@/components/payments/contacts-card";
export default function Home() {
  const {
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
  } = usePaymentWorkspace();
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-icon">s</span>steward<span className="brand-dot">.</span>
        </a>
        <div className="nav-label">YOUR WORKSPACE</div>
        <a className="nav-active" href="#overview">
          <Wallet size={18} /> Payments
        </a>
        <a href="#contacts">↗ &nbsp; Your contacts</a>
        <a href="#activity">◷ &nbsp; Activity</a>
        <div className="sidebar-bottom">
          <ShieldCheck size={23} />
          <strong>Your wallet. Your approval.</strong>
          <p>Steward prepares the payment. You decide when to send.</p>
          <span className="small">POWERED BY SERV</span>
        </div>
      </aside>
      <main id="overview">
        <header>
          <span className="network">
            <i />
            {config?.chainName || "Connecting to testnet…"}
          </span>
          <button
            className="wallet-button"
            disabled={busy || initializing || !config}
            onClick={() => void run(toggleWallet)}
          >
            <Wallet size={16} />
            {wallet ? short(wallet) + " · Disconnect" : "Connect wallet"}
          </button>
        </header>
        <div className="page-heading">
          <div className="eyebrow">SIMPLE PAYMENTS. ALWAYS IN YOUR CONTROL.</div>
          <h1>
            A little less effort.
            <br />A lot more flow.
          </h1>
          <p>Send wallet to wallet, with a little help from Steward.</p>
        </div>
        <div className="test-banner">
          <span>TESTNET</span> Demo USD is a test token with no monetary value. Network fees use
          test ETH.
        </div>
        {error && (
          <div role="alert" className="alert">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="notice">
            {notice}
          </div>
        )}
        {config && !config.token && (
          <div className="alert">
            Payment setup is pending: deploy the demo token and configure its address on the server.
          </div>
        )}
        <div className="grid">
          <BalanceCard
            config={config}
            wallet={wallet}
            balance={balance}
            busy={busy}
            receive={receive}
            setReceive={setReceive}
          />
          <PaymentForm
            config={config}
            wallet={wallet}
            contacts={contacts}
            busy={busy}
            recipient={recipient}
            setRecipient={setRecipient}
            amount={amount}
            setAmount={setAmount}
            note={note}
            setNote={setNote}
            run={run}
            preparePayment={preparePayment}
          />
          <AssistantChat
            config={config}
            wallet={wallet}
            messages={messages}
            payments={payments}
            message={message}
            setMessage={setMessage}
            busy={busy}
            run={run}
            sendMessage={sendMessage}
          />
          <PaymentReview
            config={config}
            wallet={wallet}
            review={review}
            busy={busy}
            recovery={recovery}
            setRecovery={setRecovery}
            run={run}
            send={send}
            recoverPayment={recoverPayment}
            refreshReceipt={refreshReceipt}
          />
        </div>
        {receive && wallet && (
          <ReceiveCard config={config} wallet={wallet} run={run} copyAddress={copyAddress} />
        )}
        <PaymentActivity
          wallet={wallet}
          busy={busy}
          payments={payments}
          run={run}
          load={load}
          select={select}
        />
        <ContactsCard
          wallet={wallet}
          busy={busy}
          contacts={contacts}
          name={name}
          setName={setName}
          contactAddress={contactAddress}
          setContactAddress={setContactAddress}
          run={run}
          saveContact={saveContact}
          removeContact={removeContact}
        />
        <footer>
          <span>
            Steward Pay · Built for Robinhood Chain · <a href="/privacy">Privacy</a> ·{" "}
            <a href="/data-deletion">Data deletion</a>
          </span>
          <button
            disabled={!wallet || !config?.token || busy}
            onClick={() => void run(claimTokens)}
          >
            Claim test tokens
          </button>
        </footer>
        {busy && (
          <div className="working" role="status">
            Working… Check your wallet if a signature is requested.
          </div>
        )}
      </main>
    </div>
  );
}
