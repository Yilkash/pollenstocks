import { z } from "zod";
import { settings } from "@/server/config";
import { store } from "@/server/store";
import { AppError } from "@/lib/shared";
import { paymentInput, prepare, claim, attachHash, refresh } from "@/server/payments";
import { json } from "../http";
import type { AuthenticatedContext } from "../types";
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export async function paymentsRoute({ path, method, body, wallet }: AuthenticatedContext) {
  if (path[0] === "payments") {
    if (path.length === 1) {
      if (method === "GET") return json(store().history(wallet, settings().chain.id));
      if (method === "POST") return json(await prepare(wallet, paymentInput.parse(body)), 201);
    }
    const id = z.string().uuid().parse(path[1]);
    if (method === "GET" && path.length === 2) return json(store().payment(wallet, id));
    if (method === "POST" && path[2] === "claim") return json(await claim(wallet, id));
    if (method === "POST" && path[2] === "submitted") {
      const input = z.object({ hash }).strict().parse(body);
      return json(await attachHash(wallet, id, input.hash as `0x${string}`));
    }
    if (method === "POST" && path[2] === "refresh") return json(await refresh(wallet, id));
    if (method === "POST" && path[2] === "outcome") {
      const { status } = z
        .object({ status: z.enum(["rejected", "unknown"]) })
        .strict()
        .parse(body);
      const p = store().payment(wallet, id);
      if (p.hash)
        throw new AppError("This payment has a transaction hash. Refresh its receipt.", 409);
      return json(
        store().transition(
          {
            ...p,
            status,
            error:
              status === "unknown"
                ? "Wallet outcome is unknown. Recover the transaction hash before any retry."
                : "Request rejected in the wallet.",
          },
          ["signing"],
        ),
      );
    }
  }
  return null;
}
