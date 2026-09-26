import { Sparkles, ArrowUpRight } from "lucide-react";
import type { PaymentWorkspace } from "@/hooks/use-payment-workspace";
export function AssistantChat({
  config,
  wallet,
  messages,
  payments,
  message,
  setMessage,
  busy,
  run,
  sendMessage,
}: Pick<
  PaymentWorkspace,
  | "config"
  | "wallet"
  | "payments"
  | "messages"
  | "message"
  | "setMessage"
  | "busy"
  | "run"
  | "sendMessage"
>) {
  return (
    <section className="card assistant-card">
      <div className="section-title">
        <h2>
          <Sparkles size={19} /> Your payment assistant
        </h2>
        <span className="tag">{config?.servReady ? "SERV" : "Setup pending"}</span>
      </div>
      <p className="muted">Ask naturally. Check the details. Approve in your wallet.</p>
      <p className="small">Chat and relevant payment details are processed by SERV.</p>
      <div className="conversation" aria-live="polite">
        {messages.length ? (
          messages.map((m, i) => {
            // Older draft messages contain their ID in text; new ones have a durable link.
            const payment =
              m.role === "assistant"
                ? payments.find((p) =>
                    m.paymentId ? p.id === m.paymentId : m.content.includes(p.id),
                  )
                : undefined;
            const updated = payment && payment.status !== "draft";
            const descriptions = {
              cancelled: "Cancelled by an included transaction using the same nonce.",
              replaced:
                "Replaced by a different included transaction. Inspect its receipt before sending again.",
              signing: "Waiting for the wallet outcome. Do not submit it again.",
              submitted: "Submitted. Refresh the receipt to check chain inclusion.",
              included:
                "Included on chain. A matching transfer was verified; this is not final settlement.",
              rejected: "The signing request was stopped or rejected.",
              failed: "The payment failed verification or reverted. Check the payment details.",
              unknown: "The outcome is unknown. Recover the transaction before trying again.",
              expired: "The draft expired. Prepare a new payment if you still want to send it.",
              draft: "Review the payment and approve it in your wallet.",
            };
            return (
              <div key={i} className={"bubble " + m.role}>
                <strong>
                  {m.role === "user" ? "You" : updated ? "Steward · Payment update" : "Steward"}
                </strong>
                <p>
                  {updated
                    ? payment.amount +
                      " Demo USD to " +
                      payment.recipientName +
                      ". " +
                      descriptions[payment.status]
                    : m.content}
                </p>
                {payment?.hash && config?.explorer && (
                  <a
                    href={config.explorer + "/tx/" + payment.hash}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View transaction ↗
                  </a>
                )}
              </div>
            );
          })
        ) : (
          <div className="empty-chat">
            <Sparkles size={27} />
            <p>“Send 5 Demo USD to Ada for lunch.”</p>
            <small>Save Ada’s wallet in your contacts first.</small>
          </div>
        )}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void run(sendMessage);
        }}
      >
        <input
          aria-label="Message Steward"
          maxLength={1500}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ask Steward to prepare a payment…"
          required
        />
        <button
          className="primary"
          disabled={!wallet || !config?.servReady || busy}
          aria-label="Send message"
        >
          <ArrowUpRight size={20} />
        </button>
      </form>
    </section>
  );
}
