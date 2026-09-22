import { Sparkles, ArrowUpRight } from "lucide-react";
import type { PaymentWorkspace } from "@/hooks/use-payment-workspace";
export function AssistantChat({
  config,
  wallet,
  messages,
  message,
  setMessage,
  busy,
  run,
  sendMessage,
}: Pick<
  PaymentWorkspace,
  "config" | "wallet" | "messages" | "message" | "setMessage" | "busy" | "run" | "sendMessage"
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
          messages.map((m, i) => (
            <div key={i} className={"bubble " + m.role}>
              <strong>{m.role === "user" ? "You" : "Steward"}</strong>
              <p>{m.content}</p>
            </div>
          ))
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
