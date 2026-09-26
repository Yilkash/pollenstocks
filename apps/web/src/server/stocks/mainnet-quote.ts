import { z } from "zod";
import type { Hex } from "viem";
import { fetchMainnetRoute, TemporaryKyberError } from "./kyber-route";
import { KYBER_ROUTER, requireTrade, sameAddress } from "./mainnet-trade";
import { prepareLifiQuote, type PreparedMainnetQuote, type QuoteInput } from "./lifi-route";
const uint = z.string().regex(/^\d{1,78}$/);
export async function prepareKyberQuote(p: QuoteInput): Promise<PreparedMainnetQuote> {
  const query = new URLSearchParams({
    tokenIn: p.inputToken,
    tokenOut: p.outputToken,
    amountIn: p.amountIn,
    excludeRFQSources: "true",
  });
  const routeResponse = await fetchMainnetRoute(query);
  const route = z
    .object({
      code: z.literal(0),
      data: z.object({
        routerAddress: z.string(),
        routeSummary: z
          .object({
            tokenIn: z.string(),
            tokenOut: z.string(),
            amountIn: uint,
            amountOut: uint,
            gas: uint,
            timestamp: z.coerce.number().int().positive(),
          })
          .passthrough(),
      }),
    })
    .parse(await routeResponse.json()).data;
  requireTrade(
    sameAddress(route.routerAddress, KYBER_ROUTER) &&
      sameAddress(route.routeSummary.tokenIn, p.inputToken) &&
      sameAddress(route.routeSummary.tokenOut, p.outputToken) &&
      BigInt(route.routeSummary.amountIn) === BigInt(p.amountIn),
  );
  requireTrade(
    Math.abs(Date.now() - route.routeSummary.timestamp * 1000) <= 30000,
    "route_expired",
  );
  const deadline = Math.floor(Date.now() / 1000) + 240;
  const buildResponse = await fetch(
    "https://aggregator-api.kyberswap.com/robinhood/api/v1/route/build",
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-client-id": "steward-pay" },
      body: JSON.stringify({
        routeSummary: route.routeSummary,
        sender: p.wallet,
        recipient: p.wallet,
        origin: p.wallet,
        deadline,
        slippageTolerance: 100,
        source: "steward-pay",
        enableGasEstimation: false,
      }),
      signal: AbortSignal.timeout(12000),
      redirect: "error",
      cache: "no-store",
    },
  ).catch(() => {
    throw new TemporaryKyberError("route_build_unavailable");
  });
  if ([429, 502, 503, 504].includes(buildResponse.status)) {
    await buildResponse.body?.cancel();
    throw new TemporaryKyberError("route_build_unavailable");
  }
  requireTrade(buildResponse.ok, "route_build_unavailable");
  const built = z
    .object({
      code: z.literal(0),
      data: z.object({
        amountIn: uint,
        amountOut: uint,
        routerAddress: z.string(),
        transactionValue: uint,
        data: z
          .string()
          .regex(/^0x(?:[a-fA-F0-9]{2})+$/)
          .max(200000),
      }),
    })
    .parse(await buildResponse.json()).data;
  requireTrade(
    sameAddress(built.routerAddress, KYBER_ROUTER) &&
      BigInt(built.transactionValue) === 0n &&
      BigInt(built.amountIn) === BigInt(p.amountIn) &&
      BigInt(built.amountOut) > 0n,
  );
  const expected = BigInt(built.amountOut),
    minimum = (expected * 99n) / 100n;
  requireTrade(minimum > 0n);
  return {
    provider: "kyber",
    router: KYBER_ROUTER,
    data: built.data as Hex,
    expectedOutput: expected.toString(),
    minimumOutput: minimum.toString(),
    swapGas: route.routeSummary.gas,
    deadline,
  };
}
// Fallback is available only while creating a new review. Never called by the runner.
export async function prepareMainnetQuote(p: QuoteInput): Promise<PreparedMainnetQuote> {
  try {
    return await prepareKyberQuote(p);
  } catch (error) {
    if (
      !(error instanceof TemporaryKyberError) ||
      process.env.MAINNET_LIFI_FALLBACK_ENABLED !== "true"
    )
      throw error;
    console.warn("Kyber quote temporarily unavailable; requesting LI.FI fallback");
    return prepareLifiQuote(p);
  }
}
