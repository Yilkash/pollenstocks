import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Steward testnet payments",
  description:
    "Prepare and track wallet-to-wallet Demo USD payments with SERV on Robinhood Chain testnet.",
};

export default function TestnetLayout({ children }: { children: React.ReactNode }) {
  return children;
}
