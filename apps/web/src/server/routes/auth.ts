import { verifyMessage, type Address } from "viem";
import { z } from "zod";
import { settings } from "@/server/config";
import { store } from "@/server/store";
import { address, AppError } from "@/lib/shared";
import { json, cookie } from "../http";
import type { RequestContext } from "../types";
const hex = z.string().regex(/^0x[0-9a-fA-F]+$/);
export async function authRoute({
  path,
  method,
  body,
  req,
  session,
  sessionToken,
}: RequestContext) {
  if (path[0] === "session") {
    if (method === "GET") return json({ wallet: session?.wallet || null });
    if (method === "DELETE") {
      store().logout(sessionToken);
      return cookie(json({ ok: true }), "steward-session", "", 0);
    }
  }
  if (path[0] === "auth" && path[1] === "challenge" && method === "POST") {
    const input = z.object({ address: z.string() }).strict().parse(body);
    const c = store().challenge(address(input.address), settings().origin, settings().chain.id);
    return cookie(json({ message: c.message }), "steward-challenge", c.id, 300);
  }
  if (path[0] === "auth" && path[1] === "verify" && method === "POST") {
    const { signature } = z.object({ signature: hex }).strict().parse(body);
    const challengeId = req.cookies.get("steward-challenge")?.value || "";
    const c = store().getChallenge(challengeId);
    if (
      !(await verifyMessage({
        address: c.wallet as Address,
        message: c.message,
        signature: signature as `0x${string}`,
      }))
    )
      throw new AppError("Wallet signature was not valid.", 401);
    store().consumeChallenge(challengeId);
    const token = store().newSession(c.wallet);
    return cookie(
      cookie(json({ wallet: c.wallet }), "steward-session", token, 86_400),
      "steward-challenge",
      "",
      0,
    );
  }
  return null;
}
