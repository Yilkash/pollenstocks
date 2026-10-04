import {
  ArrowUpRight,
  BadgeCheck,
  Bot,
  Github,
  Landmark,
  Lock,
  MessageCircle,
  Scale,
  ShieldCheck,
  Timer,
  Vault,
} from "lucide-react";
import { publicStats } from "@/server/public-stats";
import { MAINNET_ASSETS, MAINNET_STOCK_SYMBOLS } from "@/server/networks/chain";
import styles from "./landing.module.css";
import { ThemeToggle } from "./theme-toggle";

export const dynamic = "force-dynamic";

const WHATSAPP = "https://wa.me/2347062750162?text=Hi";
const GITHUB = "https://github.com/Yilkash/pollenstocks";
const tx = (hash: string) => `https://explorer.arc.io/tx/${hash}`;

// How the 1:1 backing is proven before every trade (src/server/stocks/backing.ts).
const backing = [
  {
    icon: Landmark,
    title: "Count the tokens on Arc",
    body: "Pollenstocks reads the stock token's total supply on Arc, live.",
  },
  {
    icon: Vault,
    title: "Count the real shares",
    body: "It reads how many Robinhood stock tokens ArcStocks' vault holds on Robinhood Chain.",
  },
  {
    icon: Scale,
    title: "They must match",
    body: "If the vault does not cover every token on Arc, the trade is refused. No exceptions.",
  },
  {
    icon: BadgeCheck,
    title: "Shown on every review",
    body: "“✅ Backed 1:1: vault verified on Robinhood Chain”, checked again right before sending.",
  },
];

// Real trades from a Pollenstocks wallet on Arc mainnet, 4 October 2026.
const proof = [
  {
    label: "Bought NVIDIA with 1 USDC · 0.004242 NVDA",
    hash: "0x05844692f71f3ae91881b834d5ea2d272e6b5469cc9527eb20b81e933e334236",
  },
  {
    label: "Sold 0.002 NVIDIA for 0.4675 USDC",
    hash: "0x98adb55e84343a628b77834b2b33e32c9979bc3c31c8e7a1697e0d0c90aec462",
  },
  {
    label: "Bought Tesla with 1 USDC · 0.002669 TSLA",
    hash: "0x7c94c5617751d7a35cdd581b9eb2ff2027cefc726cb83bddee44f212bf50c109",
  },
];

const examples = [
  "Buy NVIDIA with 5 USDC",
  "What would 10 USDC get me in Tesla?",
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
    title: "Backing and price checked",
    body: "Before you see a quote, Pollenstocks confirms the stock is held 1:1 in ArcStocks' vault on Robinhood Chain and compares the price with Robinhood's live bid and ask.",
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
    body: "Any price more than 2% worse than Robinhood's live market is refused, and halted stocks are skipped.",
  },
  {
    icon: ShieldCheck,
    title: "Backed 1:1, proven live",
    body: "Each token's supply on Arc is checked against ArcStocks' vault on Robinhood Chain before every trade. If it isn't fully backed, Pollenstocks won't trade it.",
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
          <a href="#backing">Backing</a>
          <a href="#one-coin">One coin</a>
          <a href="#proof">Proof</a>
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
              Buy NVIDIA, Tesla, Apple, Amazon, Meta, Google, the S&P 500 and the Nasdaq-100 right
              inside WhatsApp. On Arc, USDC also pays the network fee, so it is the only coin you
              ever need.
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
          <div className={styles.phones}>
            <img
              src="/images/whatsapp-sell-receipt.jpg"
              alt="Pollenstocks in WhatsApp confirming an NVIDIA sale with an Arc explorer receipt"
              className={styles.phoneBack}
            />
            <img
              src="/images/whatsapp-buy-review.jpg"
              alt="Pollenstocks in WhatsApp reviewing a 1 USDC NVIDIA buy, backed 1:1 with the vault verified"
              className={styles.phoneFront}
            />
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

        <section className={styles.section}>
          <p className={styles.eyebrow}>Live on WhatsApp</p>
          <h2>Real screens, real money.</h2>
          <div className={styles.shots}>
            <figure>
              <img
                src="/images/whatsapp-stocks.jpg"
                alt="Pollenstocks listing the eight stocks, each backed 1:1"
              />
              <figcaption>Eight stocks, each backed 1:1</figcaption>
            </figure>
            <figure>
              <img
                src="/images/whatsapp-buy-review.jpg"
                alt="Pollenstocks reviewing a 1 USDC NVIDIA buy with the backing verified"
              />
              <figcaption>Exact review, vault verified</figcaption>
            </figure>
            <figure>
              <img
                src="/images/whatsapp-sell-review.jpg"
                alt="Pollenstocks reviewing a sale of 0.002 NVIDIA"
              />
              <figcaption>Selling is just as simple</figcaption>
            </figure>
            <figure>
              <img
                src="/images/whatsapp-sell-receipt.jpg"
                alt="Pollenstocks confirming a completed sale with an Arc explorer link"
              />
              <figcaption>Receipt with an Arc explorer link</figcaption>
            </figure>
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

        <section id="backing" className={styles.section}>
          <p className={styles.eyebrow}>Backed 1:1, proven live</p>
          <h2>Don’t take the backing on trust.</h2>
          <p className={styles.sectionLead}>
            Every stock token comes from ArcStocks and is minted only against a real Robinhood stock
            token locked in its vault on Robinhood Chain. Pollenstocks checks this on both chains
            before every single trade.
          </p>
          <div className={styles.grid4}>
            {backing.map(({ icon: Icon, title, body }, index) => (
              <article key={title} className={styles.card}>
                <span className={styles.stepNo}>{index + 1}</span>
                <Icon size={22} />
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
          <p className={styles.note}>
            Check it yourself: compare NVDA&apos;s supply on Arc (<code>0x0A2d…65f2</code>) with the
            vault&apos;s balance on Robinhood Chain (<code>0xe77b…1bcd</code>). The commands are in
            the <a href={`${GITHUB}#-stocks-on-arc`}>README</a>.
          </p>
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
              <b>One coin. A trade costs about $0.002 in fees.</b>
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

        <section id="proof" className={styles.section}>
          <p className={styles.eyebrow}>Don’t trust us, check the chain</p>
          <h2>Real trades on Arc mainnet</h2>
          <ul className={styles.proof}>
            {proof.map(({ label, hash }) => (
              <li key={hash}>
                <span>{label}</span>
                <a href={tx(hash)}>
                  <code>
                    {hash.slice(0, 10)}…{hash.slice(-6)}
                  </code>
                  <ArrowUpRight size={15} />
                </a>
              </li>
            ))}
          </ul>
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
          by ArcStocks and are not direct share ownership.
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
