import { QRCodeSVG } from "qrcode.react";
import type { PaymentWorkspace } from "@/hooks/use-payment-workspace";
export function ReceiveCard({
  config,
  wallet,
  run,
  copyAddress,
}: Pick<PaymentWorkspace, "config" | "wallet" | "run" | "copyAddress">) {
  if (!wallet) return null;
  return (
    <section className="card receive-card">
      <div>
        <h2>Receive Demo USD</h2>
        <p>Share this address on {config?.chainName} only.</p>
        <code>{wallet}</code>
        <button onClick={() => void run(copyAddress)}>Copy address</button>
      </div>
      <QRCodeSVG
        value={"ethereum:" + wallet + "@" + config?.chainId}
        size={144}
        title="Your wallet address"
      />
    </section>
  );
}
