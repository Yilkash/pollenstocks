import {
  ArrowUpRight,
  BadgeCheck,
  Bot,
  Github,
  Lock,
  MessageCircle,
  Scale,
  ShieldCheck,
  Timer,
} from "lucide-react";
import { publicStats } from "@/server/public-stats";
import { MAINNET_ASSETS, MAINNET_STOCK_SYMBOLS } from "@/server/networks/chain";
import styles from "./landing.module.css";
import { ThemeToggle } from "./theme-toggle";

export const dynamic = "force-dynamic";

// Set the WhatsApp number once it is connected.
const WHATSAPP = process.env.NEXT_PUBLIC_WHATSAPP_LINK || "https://wa.me/";
const GITHUB = "https://github.com/Yilkash/pollenstocks";

const examples = [
  "Buy NVIDIA with 5 USDC",
  "What would 10 USDC get me in Circle?",
  "Sell 0.01 NVIDIA",
  "What are the prices?",
  "Show my stocks",
  "Send 2 USDC to Ada",
];

const steps = [
  {
    icon: MessageCircle,
    title: "Text what you want",
    body: "Plain language in WhatsApp. No app to install, no seed phrase to write down.",
  },
  {
    icon: Bot,
    title: "AI understands you",
    body: "SERV Reasoning turns your message into the right action, with a prompt-injection guard on every message.",
  },
  {
    icon: Scale,
    title: "Checked against the market",
    body: "The KyberSwap route on Arc is compared with Robinhood's live bid and ask. Unfair prices are refused.",
  },
  {
    icon: BadgeCheck,
    title: "You tap Confirm",
    body: "The trade settles on Arc in under a second and you get an explorer receipt in the chat.",
  },
];

const safety = [
  {
    icon: Lock,
    title: "The AI never holds keys",
    body: "No tool can confirm or submit a transaction. Only your button press can.",
  },
  {
    icon: Scale,
    title: "Fair price or nothing",
    body: "Any route more than 2% worse than Robinhood's live market is refused, and halted stocks are skipped.",
  },
  {
    icon: ShieldCheck,
    title: "No copycat tokens",
    body: "Arc has fake tokens with the same names. Pollenstocks trades only pinned addresses, verified on-chain before every trade.",
  },
  {
    icon: Timer,
    title: "Exact, expiring reviews",
    body: "Every review shows the minimum received and maximum fee, expires in 4 minutes, and confirms once.",
  },
];

export default function Landing() {
  const stats = publicStats();
  return (
    <div className={styles.page}>
      <header className={styles.nav}>
        <a className={styles.brand} href="/">
          <img className={styles.brandLogo} src="/images/pollenstocks-logo.png" alt="" />
          <span>
            pollenstocks<span className={styles.dot}>.</span>
          </span>
        </a>
        <nav className={styles.links} aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#one-coin">One coin</a>
          <a href="#safety">Safety</a>
          <a href={GITHUB}>GitHub</a>
        </nav>
        <div className={styles.navEnd}>
          <ThemeToggle />
          <a className={styles.navCta} href={WHATSAPP}>
            <MessageCircle size={16} /> Chat now
          </a>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Tokenized US stocks · Arc</p>
            <h1>
              Own US stocks with just <span className={styles.highlight}>USDC</span>.
            </h1>
            <p className={styles.lead}>
              Buy NVIDIA, Circle, GameStop and AMC right inside WhatsApp. On Arc, USDC also pays the
              network fee, so it is the only coin you ever need.
            </p>
            <div className={styles.ctas}>
              <a className={styles.primary} href={WHATSAPP}>
                <MessageCircle size={18} /> Start on WhatsApp
              </a>
              <a className={styles.secondary} href="#one-coin">
                Why one coin matters <ArrowUpRight size={16} />
              </a>
            </div>
          </div>
          <div className={styles.phoneMock} aria-label="Example Pollenstocks conversation">
            <div className={styles.phoneHeader}>
              <img className={styles.brandLogo} src="/images/pollenstocks-logo.png" alt="" />
              Pollenstocks
            </div>
            <div className={styles.chat}>
              <p className={styles.me}>Buy NVIDIA with 5 USDC</p>
              <p className={styles.bot}>
                <b>Buy NVIDIA (NVDA)</b>
                <br />
                Arc
                <br />
                <br />
                Pay: 5 USDC
                <br />
                Receive: ≈ 0.02161 NVDA
                <br />
                Network fee: up to 0.01 USDC
                <br />
                <b>[ Confirm buy ]</b>
              </p>
              <p className={styles.me}>Confirm buy</p>
              <p className={styles.bot}>Trade complete ✅ Arc explorer receipt ↗</p>
            </div>
          </div>
        </section>

        <section className={styles.stats} aria-label="Pollenstocks at a glance">
          {stats && (
            <>
              <div>
                <b>{stats.users}</b>
                <span>users with their own wallet</span>
              </div>
              <div>
                <b>{stats.confirmed}</b>
                <span>confirmed trades and payments on Arc</span>
              </div>
            </>
          )}
          <div>
            <b>{MAINNET_STOCK_SYMBOLS.length}</b>
            <span>
              stocks: {MAINNET_STOCK_SYMBOLS.map((s) => MAINNET_ASSETS[s].name).join(", ")}
            </span>
          </div>
          <div>
            <b>1</b>
            <span>coin for everything: USDC</span>
          </div>
        </section>

        <section className={styles.section}>
          <p className={styles.eyebrow}>Just say it</p>
          <h2>Things you can text Pollenstocks</h2>
          <div className={styles.examples}>
            {examples.map((text) => (
              <code key={text}>{text}</code>
            ))}
          </div>
        </section>

        <section id="how" className={styles.section}>
          <p className={styles.eyebrow}>How it works</p>
          <h2>AI understands. Code checks. You confirm.</h2>
          <div className={styles.grid4}>
            {steps.map(({ icon: Icon, title, body }, index) => (
              <article key={title} className={styles.card}>
                <span className={styles.stepNo}>{index + 1}</span>
                <Icon size={22} />
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="one-coin" className={styles.section}>
          <p className={styles.eyebrow}>Why Arc</p>
          <h2>No second coin for gas.</h2>
          <p className={styles.sectionLead}>
            On most chains, a new user must first buy ETH or BNB just to pay fees, before they can
            buy their first stock. That is where most people give up. On Arc, Circle's chain, the
            network fee is paid in USDC. Fund your wallet with USDC and you are done.
          </p>
          <ul className={styles.comparison}>
            <li className={styles.bad}>
              <code>Other chains</code>
              <span>Dollar coin + gas coin</span>
              <b>Two coins to buy before your first trade</b>
            </li>
            <li className={styles.best}>
              <code>Arc</code>
              <span>USDC only</span>
              <b>One coin. A trade costs under one cent in fees.</b>
            </li>
          </ul>
        </section>

        <section id="safety" className={`${styles.section} ${styles.dark}`}>
          <p className={styles.eyebrow}>Built so the AI can’t move your money</p>
          <h2>Safety is the product.</h2>
          <div className={styles.grid4}>
            {safety.map(({ icon: Icon, title, body }) => (
              <article key={title} className={styles.darkCard}>
                <Icon size={22} />
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.final}>
          <h2>Your first stock is one message away.</h2>
          <p>Say hi, create your account, add a little USDC on Arc, and start owning.</p>
          <a className={styles.primary} href={WHATSAPP}>
            <MessageCircle size={18} /> Chat with Pollenstocks
          </a>
        </section>
      </main>

      <footer className={styles.footer}>
        <span>
          Pollenstocks by Steward Pay · Powered by SERV Reasoning · Stock tokens on Arc are issued
          by a third party and are not direct share ownership.
        </span>
        <nav aria-label="Footer">
          <a href={GITHUB}>
            <Github size={14} /> GitHub
          </a>
          <a href="/privacy">Privacy</a>
          <a href="/data-deletion">Data deletion</a>
        </nav>
      </footer>
    </div>
  );
}
