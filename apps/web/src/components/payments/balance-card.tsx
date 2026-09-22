import { ArrowUpRight, ArrowDownLeft, Wallet } from "lucide-react";
import type { PaymentWorkspace } from "@/hooks/use-payment-workspace";
export function BalanceCard({
  config,
  wallet,
  balance,
  busy,
  receive,
  setReceive,
}: Pick<PaymentWorkspace, "config" | "wallet" | "balance" | "busy" | "receive" | "setReceive">) {
  return (
    <section className="balance-card">
      <div className="card-top">
        <span>Available balance</span>
        <Wallet size={21} />
      </div>
      <div className="balance">
        {balance?.token ?? "—"}
        <span>Demo USD</span>
      </div>
      <p>{wallet ? "On your connected wallet" : "Connect your wallet to get started"}</p>
      <div className="actions">
        <button
          disabled={!wallet || busy || !config?.token}
          onClick={() => document.getElementById("recipient")?.focus()}
        >
          <ArrowUpRight size={17} />
          Send
        </button>
        <button className="ghost-light" disabled={!wallet} onClick={() => setReceive(!receive)}>
          <ArrowDownLeft size={17} />
          Receive
        </button>
      </div>
      <div className="gas">
        Network fee balance <strong>{balance ? balance.eth + " ETH" : "—"}</strong>
      </div>
    </section>
  );
}
