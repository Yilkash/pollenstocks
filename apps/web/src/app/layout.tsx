import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Steward Pay — Send with confidence",
  description: "Prepare and track wallet-to-wallet test payments with SERV on Robinhood Chain.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
