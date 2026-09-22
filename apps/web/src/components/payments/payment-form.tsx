import { ArrowUpRight } from "lucide-react";
import type { PaymentWorkspace } from "@/hooks/use-payment-workspace";
export function PaymentForm({
  config,
  wallet,
  contacts,
  busy,
  recipient,
  setRecipient,
  amount,
  setAmount,
  note,
  setNote,
  run,
  preparePayment,
}: Pick<
  PaymentWorkspace,
  | "config"
  | "wallet"
  | "contacts"
  | "busy"
  | "recipient"
  | "setRecipient"
  | "amount"
  | "setAmount"
  | "note"
  | "setNote"
  | "run"
  | "preparePayment"
>) {
  return (
    <section className="card send-card">
      <div className="section-title">
        <h2>Make a payment</h2>
        <span className="tag">Wallet to wallet</span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(preparePayment);
        }}
      >
        <label htmlFor="recipient">Send to</label>
        <input
          id="recipient"
          list="contacts-list"
          placeholder="Contact name or 0x address"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          required
        />
        <datalist id="contacts-list">
          {contacts.map((c) => (
            <option key={c.name} value={c.name} />
          ))}
        </datalist>
        <div className="form-row">
          <div>
            <label htmlFor="amount">Amount · Demo USD</label>
            <input
              id="amount"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="note">
              Note <span>(optional)</span>
            </label>
            <input
              id="note"
              maxLength={160}
              placeholder="What's it for?"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <button className="primary full" disabled={!wallet || !config?.token || busy}>
          Review payment <ArrowUpRight size={17} />
        </button>
      </form>
    </section>
  );
}
