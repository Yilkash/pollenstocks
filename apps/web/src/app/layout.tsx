import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Steward — Buy stocks by texting on WhatsApp",
  description:
    "Trade Apple, NVIDIA and Tesla stock tokens with USDG on Robinhood Chain, just by chatting on WhatsApp. Powered by SERV Reasoning.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
