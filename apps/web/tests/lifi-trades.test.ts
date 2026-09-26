import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decodeFunctionData,
  encodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  keccak256,
  toBytes,
  zeroAddress,
  type Address,
  type Hex,
  type Log,
} from "viem";
import fixture from "./fixtures/lifi-robinhood-buy.json";
import { parseLifiQuote, type QuoteInput } from "../src/server/stocks/lifi-route";
import {
  LIFI_ROUTER,
  LIFI_FUNCTION,
  LIFI_FEE_RECIPIENT,
  lifiRouterAbi,
  lifiFeeAbi,
} from "../src/server/stocks/lifi-contracts";
import { prepareMainnetQuote } from "../src/server/stocks/mainnet-quote";
import { validateMainnetPlan, type MainnetPlan } from "../src/server/stocks/mainnet-trade";
import { mainnetTradeOutput } from "../src/server/stocks/mainnet-trade-receipt";
import { lifiPolicyRule, validateMainnetPolicyRules } from "../src/server/stocks/mainnet-policy";
const request: QuoteInput = {
  wallet: fixture.action.fromAddress as Address,
  inputToken: fixture.action.fromToken.address as Address,
  outputToken: fixture.action.toToken.address as Address,
  amountIn: fixture.action.fromAmount,
};
process.env.MAINNET_KYBER_EXECUTOR = "0x1111111111111111111111111111111111111111";
process.env.MAINNET_KYBER_EXECUTOR_CODEHASH = "0x" + "11".repeat(32);
process.env.MAINNET_ROUTER_CODEHASH = "0x" + "22".repeat(32);
process.env.PRIVY_MAINNET_POLICY_ID = "test-policy";
process.env.MAINNET_MAX_USDG_PER_TRADE = "10";
process.env.MAINNET_LIFI_FALLBACK_ENABLED = "true";
function plan(): MainnetPlan {
  const q = parseLifiQuote(fixture, request, Date.now());
  const id = "11111111-1111-4111-8111-111111111111";
  return {
    ...request,
    ...q,
    id,
    orderId: keccak256(toBytes(`steward-mainnet-v1:${request.wallet.toLowerCase()}:${id}`)),
    symbol: "AAPL",
    side: "buy",
    steps: [
      {
        kind: "approve",
        to: request.inputToken,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [LIFI_ROUTER, BigInt(request.amountIn)],
        }),
        gas: "100000",
        gasPrice: "1000000",
      },
      { kind: "trade", to: LIFI_ROUTER, data: q.data, gas: "800000", gasPrice: "1000000" },
    ],
  };
}
test("real synthetic LI.FI quote decodes and creates a valid exact-approval plan", () => {
  const p = plan();
  assert.equal(p.providerFee?.amount, "500");
  assert.doesNotThrow(() => validateMainnetPlan(p));
});
test("rejects malformed quote metadata, chains, tools, wallets, amounts and fees", () => {
  const mutations: ((q: typeof fixture) => void)[] = [
    (q) => {
      q.action.toChainId = 1;
    },
    (q) => {
      q.action.toAddress = zeroAddress;
    },
    (q) => {
      q.action.fromToken.decimals = 18;
    },
    (q) => {
      q.action.fromAmount = "1";
    },
    (q) => {
      q.transactionRequest.value = "0x1";
    },
    (q) => {
      q.transactionRequest.to = zeroAddress;
    },
    (q) => {
      q.transactionRequest.chainId = 1;
    },
    (q) => {
      q.estimate.approvalAddress = zeroAddress;
    },
    (q) => {
      q.tool = "kyberswap";
    },
    (q) => {
      q.includedSteps[1].tool = "kyberswap";
    },
    (q) => {
      q.estimate.toAmountMin = "1";
    },
    (q) => {
      q.estimate.feeCosts[0].included = false;
    },
    (q) => {
      q.estimate.feeCosts[0].amount = "1000";
    },
    (q) => {
      q.includedSteps[1].action.toToken.address = zeroAddress;
    },
  ];
  for (const mutate of mutations) {
    const q = structuredClone(fixture);
    mutate(q);
    assert.throws(() => parseLifiQuote(q, request, Date.now()));
  }
  assert.throws(() => parseLifiQuote(fixture, request, Date.now() - 31000), /route_expired/);
});
test("rejects tampered outer swap and packed Nordstern terms", () => {
  const mutations: ((args: ReturnType<typeof decode>) => void)[] = [
    (a) => {
      a[0] = `0x${"01".repeat(32)}`;
    },
    (a) => {
      a[1] = "other";
    },
    (a) => {
      a[3] = zeroAddress;
    },
    (a) => {
      a[4] = 1n;
    },
    (a) => {
      a[5][1].requiresDeposit = true;
    },
    (a) => {
      a[5][1].callTo = zeroAddress;
    },
    (a) => {
      a[5][1].approveTo = zeroAddress;
    },
    (a) => {
      a[5][0].callData = encodeFunctionData({
        abi: lifiFeeAbi,
        functionName: "forwardERC20Fees",
        args: [request.inputToken, [{ recipient: zeroAddress, amount: 500n }]],
      });
    },
    (a) => {
      a[5][0].callData = encodeFunctionData({
        abi: lifiFeeAbi,
        functionName: "forwardERC20Fees",
        args: [request.inputToken, [{ recipient: LIFI_FEE_RECIPIENT, amount: 501n }]],
      });
    },
    ...[6, 26, 42, 59, 79, 99, 119].map((offset) => (a: ReturnType<typeof decode>) => {
      const c = a[5][1].callData;
      const at = 2 + offset * 2;
      a[5][1].callData = (c.slice(0, at) +
        (c.slice(at, at + 2) === "00" ? "01" : "00") +
        c.slice(at + 2)) as Hex;
    }),
  ];
  for (const mutate of mutations) {
    const p = plan();
    const args = decode(p.steps[1].data);
    mutate(args);
    p.steps[1].data = encodeFunctionData({ abi: lifiRouterAbi, functionName: LIFI_FUNCTION, args });
    assert.throws(() => validateMainnetPlan(p));
  }
  const p = plan();
  p.provider = "kyber";
  assert.throws(() => validateMainnetPlan(p));
  const disabled = process.env.MAINNET_LIFI_FALLBACK_ENABLED;
  process.env.MAINNET_LIFI_FALLBACK_ENABLED = "false";
  try {
    assert.throws(() => validateMainnetPlan(plan()), /lifi_disabled/);
  } finally {
    process.env.MAINNET_LIFI_FALLBACK_ENABLED = disabled;
  }
});
// Mutable copy of ABI args for adversarial fixture construction.
function decode(data: Hex) {
  const a = decodeFunctionData({ abi: lifiRouterAbi, data }).args;
  return [a[0], a[1], a[2], a[3], a[4], a[5].map((s) => ({ ...s }))] as [
    Hex,
    string,
    string,
    Address,
    bigint,
    {
      callTo: Address;
      approveTo: Address;
      sendingAssetId: Address;
      receivingAssetId: Address;
      fromAmount: bigint;
      callData: Hex;
      requiresDeposit: boolean;
    }[],
  ];
}
test("only transient Kyber errors trigger LI.FI; disabled and validation failures never reroute", async () => {
  const original = global.fetch;
  let calls: string[] = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return String(url).startsWith("https://li.quest/")
      ? Response.json(fixture)
      : new Response("busy", { status: 503 });
  };
  try {
    assert.equal((await prepareMainnetQuote(request)).provider, "lifi");
    assert.equal(calls.filter((u) => u.startsWith("https://li.quest/")).length, 1);
    assert.match(calls.at(-1)!, /denyExchanges=kyberswap/);
    calls = [];
    process.env.MAINNET_LIFI_FALLBACK_ENABLED = "false";
    await assert.rejects(prepareMainnetQuote(request), /route_busy/);
    assert.equal(calls.length, 2);
    process.env.MAINNET_LIFI_FALLBACK_ENABLED = "true";
    for (const status of [400, 401, 403, 404]) {
      calls = [];
      global.fetch = async (u) => {
        calls.push(String(u));
        return new Response("no", { status });
      };
      await assert.rejects(prepareMainnetQuote(request));
      assert.equal(calls.length, 1);
    }
    calls = [];
    global.fetch = async (u) => {
      calls.push(String(u));
      return Response.json({ code: 0, data: {} });
    };
    await assert.rejects(prepareMainnetQuote(request));
    assert.equal(calls.length, 1);
  } finally {
    global.fetch = original;
    process.env.MAINNET_LIFI_FALLBACK_ENABLED = "true";
  }
});
test("policy accepts legacy Kyber rules and only the narrow extra LI.FI rule", () => {
  const base = JSON.parse(
    readFileSync(new URL("../../../docs/privy-mainnet-policy.json", import.meta.url), "utf8"),
  ).rules;
  assert.doesNotThrow(() => validateMainnetPolicyRules(base, false));
  assert.throws(() => validateMainnetPolicyRules(base, true));
  assert.doesNotThrow(() => validateMainnetPolicyRules([...base, lifiPolicyRule], true));
  assert.doesNotThrow(() => validateMainnetPolicyRules([...base, lifiPolicyRule], false));
  const modified = structuredClone(lifiPolicyRule);
  modified.conditions[3].abi = [];
  assert.throws(() => validateMainnetPolicyRules([...base, modified], true));
  assert.throws(() => validateMainnetPolicyRules([...base, lifiPolicyRule, lifiPolicyRule], true));
});
function logs(p: MainnetPlan): Log[] {
  const common = {
    blockHash: null,
    blockNumber: null,
    logIndex: null,
    transactionHash: null,
    transactionIndex: null,
    removed: false,
  };
  const swap = {
    ...common,
    address: LIFI_ROUTER,
    topics: encodeEventTopics({
      abi: lifiRouterAbi,
      eventName: "LiFiGenericSwapCompleted",
      args: { transactionId: p.providerTransactionId! },
    }),
    data: encodeAbiParameters(
      [
        { type: "string" },
        { type: "string" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [
        "steward-pay",
        zeroAddress,
        p.wallet,
        p.inputToken,
        p.outputToken,
        BigInt(p.amountIn),
        BigInt(p.expectedOutput),
      ],
    ),
  };
  const transfer = (address: Address, from: Address, to: Address, amount: string) => ({
    ...common,
    address,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from, to } }),
    data: encodeAbiParameters([{ type: "uint256" }], [BigInt(amount)]),
  });
  return [
    swap,
    transfer(p.inputToken, p.wallet, LIFI_ROUTER, p.amountIn),
    transfer(p.outputToken, LIFI_ROUTER, p.wallet, p.expectedOutput),
  ] as Log[];
}
test("LI.FI receipt binds transaction ID, tokens and actual wallet transfers", () => {
  const p = plan(),
    receipt = logs(p);
  assert.equal(mainnetTradeOutput(p, receipt), BigInt(p.expectedOutput));
  assert.throws(() =>
    mainnetTradeOutput({ ...p, providerTransactionId: `0x${"00".repeat(32)}` }, receipt),
  );
  assert.throws(() => mainnetTradeOutput(p, receipt.slice(0, 2)));
  assert.throws(() => mainnetTradeOutput(p, [...receipt, receipt[0]]));
  process.env.MAINNET_LIFI_FALLBACK_ENABLED = "false";
  try {
    assert.equal(mainnetTradeOutput(p, receipt), BigInt(p.expectedOutput));
  } finally {
    process.env.MAINNET_LIFI_FALLBACK_ENABLED = "true";
  }
});

test("live snapshots for all three buys and sells pass quote and plan validation", () => {
  for (const side of ["buy", "sell"] as const)
    for (const symbol of ["AAPL", "NVDA", "TSLA"] as const) {
      const raw = JSON.parse(
        readFileSync(
          new URL(`./fixtures/lifi/steward-lifi-${side}-${symbol}.json`, import.meta.url),
          "utf8",
        ),
      );
      const req = {
        wallet: raw.action.fromAddress as Address,
        inputToken: raw.action.fromToken.address as Address,
        outputToken: raw.action.toToken.address as Address,
        amountIn: raw.action.fromAmount,
      };
      const quote = parseLifiQuote(raw, req, Date.now());
      const p: MainnetPlan = { ...plan(), ...req, ...quote, symbol, side };
      p.steps = [
        {
          ...p.steps[0],
          to: req.inputToken,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [LIFI_ROUTER, BigInt(req.amountIn)],
          }),
        },
        { ...p.steps[1], data: quote.data },
      ];
      assert.doesNotThrow(() => validateMainnetPlan(p), `${side} ${symbol}`);
      assert.equal(BigInt(quote.providerFee!.amount) * 400n, BigInt(req.amountIn));
    }
});
