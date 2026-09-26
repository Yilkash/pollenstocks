import { ensureMainnetWallet } from "../src/server/stocks/mainnet-wallet";
import { getAddress, erc20Abi, formatEther, formatUnits } from "viem";
import { whatsappConfig } from "../src/server/whatsapp/config";
import { WhatsAppStore } from "../src/server/whatsapp/store";
import { mainnetWallet } from "../src/server/stocks/mainnet-orders";
import {
  checkMainnetRouter,
  mainnetRpc,
  KYBER_ROUTER,
  mainnetRouterAbi,
  requireTrade as ensure,
} from "../src/server/stocks/mainnet-trade";
import {
  MAINNET_ASSETS,
  MAINNET_USDG,
  MAINNET_EXECUTION_READY,
} from "../src/server/networks/robinhood";

async function main() {
  if (process.argv.includes("--policy-template")) {
    const conditions = (to: string, fn: string, abi: unknown) => [
      { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: "4663" },
      { field_source: "ethereum_transaction", field: "to", operator: "eq", value: to },
      { field_source: "ethereum_transaction", field: "value", operator: "eq", value: "0x0" },
      {
        field_source: "ethereum_calldata",
        field: "function_name",
        operator: "eq",
        value: fn,
        abi,
      },
    ];
    const approveAbi = [
      {
        type: "function",
        name: "approve",
        stateMutability: "nonpayable",
        inputs: [
          { name: "spender", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        outputs: [{ name: "", type: "bool" }],
      },
    ];
    console.log(
      JSON.stringify(
        {
          name: "Steward mainnet stock trades",
          version: "1.0",
          chain_type: "ethereum",
          rules: [
            ...[MAINNET_USDG, ...Object.values(MAINNET_ASSETS)].map((a) => ({
              name: `Approve ${a.address}`,
              method: "eth_sendTransaction",
              action: "ALLOW",
              conditions: conditions(a.address, "approve", approveAbi),
            })),
            {
              name: "Send mainnet USDG",
              method: "eth_sendTransaction",
              action: "ALLOW",
              conditions: conditions(MAINNET_USDG.address, "transfer", [
                {
                  type: "function",
                  name: "transfer",
                  stateMutability: "nonpayable",
                  inputs: [
                    { name: "to", type: "address" },
                    { name: "amount", type: "uint256" },
                  ],
                  outputs: [{ name: "", type: "bool" }],
                },
              ]),
            },
            {
              name: "KyberSwap stock swap",
              method: "eth_sendTransaction",
              action: "ALLOW",
              conditions: conditions(KYBER_ROUTER, "swap", mainnetRouterAbi),
            },
          ],
        },
        null,
        2,
      ),
    );
    return;
  }
  const config = whatsappConfig(),
    store = new WhatsAppStore(config.key);
  try {
    const accounts = store.db.prepare("SELECT id FROM wa_accounts WHERE status='active'").all() as {
      id: string;
    }[];
    const arg = process.argv.find((v) => v.startsWith("--account="))?.slice(10);
    const account = arg ?? (accounts.length === 1 ? accounts[0].id : undefined);
    ensure(
      account && accounts.some((a) => a.id === account),
      "choose_active_account_with_account_flag",
    );
    const names = [
      "MAINNET_KYBER_EXECUTOR",
      "MAINNET_KYBER_EXECUTOR_CODEHASH",
      "MAINNET_ROUTER_CODEHASH",
      "PRIVY_MAINNET_POLICY_ID",
      "MAINNET_MAX_USDG_PER_TRADE",
    ];
    console.log(
      "Configuration:",
      Object.fromEntries(names.map((n) => [n, process.env[n]?.trim() ? "set" : "missing"])),
    );
    console.log(
      "Trading enabled:",
      MAINNET_EXECUTION_READY && process.env.MAINNET_STOCK_TRADING_ENABLED === "true",
    );
    console.log("Execution validation complete:", MAINNET_EXECUTION_READY);
    console.log(
      "Gas payment:",
      "Fees estimated automatically per review; wallet pays ETH. Sponsorship is off.",
    );
    console.log(
      "Dedicated mainnet wallet:",
      mainnetWallet(store.db, account) ? "configured" : "missing",
    );
    const creatingWallet = process.argv.includes("--create-wallet");
    if (!creatingWallet && names.some((n) => !process.env[n]?.trim())) {
      console.log("Mainnet setup incomplete. No provider changes or transactions made.");
      return;
    }
    // An empty wallet can be provisioned before trade validation and fee limits.
    // Execution still requires checkMainnetRouter in both preparation and submission.
    const policy = process.env.PRIVY_MAINNET_POLICY_ID?.trim();
    ensure(policy, "mainnet_policy_required");
    if (!creatingWallet) {
      await checkMainnetRouter();
      console.log("KyberSwap router and executor code pins verified.");
    }
    let wallet = mainnetWallet(store.db, account);
    if (!wallet && process.argv.includes("--create-wallet")) {
      wallet = await ensureMainnetWallet(store.db, account);
    }
    if (!wallet) {
      console.log(
        "Dedicated mainnet wallet missing. Use --create-wallet after configuring the separate policy.",
      );
      return;
    }
    const address = getAddress(wallet.address);
    const [eth, usdg] = await Promise.all([
      mainnetRpc.getBalance({ address }),
      mainnetRpc.readContract({
        address: MAINNET_USDG.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      }),
    ]);
    console.log({
      wallet: address,
      chain: 4663,
      ETH: formatEther(eth),
      USDG: formatUnits(usdg, 6),
    });
    console.log("No trade or funding transaction submitted.");
  } finally {
    store.close();
  }
}
main().catch(() => {
  console.error(
    "Mainnet setup stopped. Check configuration, account selection and provider status. No secrets are logged; uncertain wallet creation must be recovered by its saved external ID.",
  );
  process.exitCode = 1;
});
