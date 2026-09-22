import { ShieldCheck, ArrowUpRight, RefreshCw } from "lucide-react";
import { formatEther } from "viem";
import type { PaymentWorkspace } from "@/hooks/use-payment-workspace";
export function PaymentReview({
  config,
  wallet,
  review,
  busy,
  recovery,
  setRecovery,
  run,
  send,
  recoverPayment,
  refreshReceipt,
}: Pick<
  PaymentWorkspace,
  | "config"
  | "wallet"
  | "review"
  | "busy"
  | "recovery"
  | "setRecovery"
  | "run"
  | "send"
  | "recoverPayment"
  | "refreshReceipt"
>) {
  return (
    <section className="card review-card">
      <div className="section-title">
        <h2>Payment review</h2>
        <ShieldCheck size={20} />
      </div>
      {review ? (
        <>
          <div className="review-amount">
            {review.amount}
            <span> Demo USD</span>
          </div>
          <dl>
            <dt>Sender</dt>
            <dd>
              <code>{review.sender}</code>
            </dd>
            <dt>Recipient</dt>
            <dd>
              {review.recipientName}
              <code>{review.recipient}</code>
            </dd>
            <dt>Network</dt>
            <dd>{config?.chainName}</dd>
            <dt>Token contract</dt>
            <dd>
              <code>{review.token}</code>
            </dd>
            <dt>Fee estimate</dt>
            <dd>{formatEther(BigInt(review.gas) * BigInt(review.gasPrice))} ETH</dd>
            <dt>Status</dt>
            <dd>{review.status === "included" ? "Included on chain" : review.status}</dd>
            {review.note && (
              <>
                <dt>Note</dt>
                <dd>{review.note}</dd>
              </>
            )}
          </dl>
          {review.recipient.toLowerCase() === review.sender.toLowerCase() && (
            <p className="alert">You are sending to your own wallet.</p>
          )}
          {review.error && <p className="muted">{review.error}</p>}
          {review.status === "draft" && (
            <>
              <p className="small">
                Review expires after 5 minutes. Fees are refreshed before your wallet opens.
              </p>
              <button
                className="primary full"
                disabled={busy || !wallet}
                onClick={() => void run(send)}
              >
                Approve in wallet <ArrowUpRight size={17} />
              </button>
            </>
          )}
          {review.hash && (
            <p className="hash">
              {config?.explorer ? (
                <a href={config.explorer + "/tx/" + review.hash} target="_blank" rel="noreferrer">
                  View transaction ↗
                </a>
              ) : (
                review.hash
              )}
            </p>
          )}
          {["signing", "unknown"].includes(review.status) && !review.hash && (
            <>
              <p className="small">
                Check your wallet’s activity before taking further action. If it sent the payment,
                recover its transaction hash here.
              </p>
              <input
                aria-label="Transaction hash"
                placeholder="0x transaction hash"
                value={recovery}
                onChange={(e) => setRecovery(e.target.value)}
              />
              <button disabled={busy || !recovery} onClick={() => void run(recoverPayment)}>
                Recover receipt
              </button>
            </>
          )}
          {review.hash && (
            <button disabled={busy} onClick={() => void run(refreshReceipt)}>
              <RefreshCw size={15} />
              Refresh receipt
            </button>
          )}
          {review.status === "included" && (
            <p className="small">
              A matching transfer was verified in the receipt. Chain inclusion is not final
              settlement.
            </p>
          )}
        </>
      ) : (
        <div className="review-empty">
          <ShieldCheck size={34} />
          <h3>No payment waiting</h3>
          <p>Prepare a payment to see the exact recipient, amount and fee here.</p>
        </div>
      )}
    </section>
  );
}
