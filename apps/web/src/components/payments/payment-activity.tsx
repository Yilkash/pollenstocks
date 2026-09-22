import { RefreshCw } from "lucide-react";
import { short } from "@/lib/browser";
import type { PaymentWorkspace } from "@/hooks/use-payment-workspace";
export function PaymentActivity({
  wallet,
  busy,
  payments,
  run,
  load,
  select,
}: Pick<PaymentWorkspace, "wallet" | "busy" | "payments" | "run" | "load" | "select">) {
  return (
    <section className="card activity" id="activity">
      <div className="section-title">
        <h2>Recent activity</h2>
        <button disabled={!wallet || busy} onClick={() => void run(load)}>
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>
      {payments.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>
                    <button className="text-button" onClick={() => void select(p)}>
                      {p.recipientName === "Wallet address" ? short(p.recipient) : p.recipientName}{" "}
                      ↗
                    </button>
                  </td>
                  <td>{p.amount} Demo USD</td>
                  <td>
                    <span className={"status " + p.status}>{p.status}</span>
                  </td>
                  <td>{new Date(p.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">Your payments will appear here. Start with a small test transfer.</p>
      )}
    </section>
  );
}
