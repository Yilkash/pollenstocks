import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Pollenstocks — Own US stocks with just USDC on WhatsApp",
  description:
    "Buy NVIDIA, Circle, GameStop and AMC stock tokens with just USDC on Arc, by chatting on WhatsApp. USDC pays the network fee too: no app, no seed phrase, no gas token.",
};
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply a saved theme before the first paint so the page never flashes. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
