import { NextRequest } from "next/server";
import { z } from "zod";
import { settings, publicConfig } from "@/server/config";
import { store } from "@/server/store";
import { address, AppError } from "@/lib/shared";
import { balances } from "@/server/payments";
import { limited, readBody, json } from "./http";
import { authRoute } from "./routes/auth";
import { contactsRoute } from "./routes/contacts";
import { paymentsRoute } from "./routes/payments";
import { chatRoute } from "./routes/chat";

// Authentication and origin checks apply before any private feature handler.
export async function handleRequest(req: NextRequest) {
  try {
    const path = req.nextUrl.pathname
      .replace(/^\/api\//, "")
      .split("/")
      .map(decodeURIComponent);
    const method = req.method;
    if (method !== "GET") {
      if (req.headers.get("origin") !== settings().origin)
        throw new AppError("Request origin is not allowed.", 403);
      limited(req.headers.get("x-forwarded-for")?.split(",")[0] || "local");
    }
    const body = method === "GET" ? {} : await readBody(req);
    if (path[0] === "config" && method === "GET") return json(publicConfig());
    const sessionToken = req.cookies.get("steward-session")?.value || "";
    const session = store().session(sessionToken);
    const context = { req, path, method, body, sessionToken, session };
    const authResponse = await authRoute(context);
    if (authResponse) return authResponse;
    if (!session) throw new AppError("Connect and sign in with your wallet first.", 401);
    const wallet = address(session.wallet);
    if (path[0] === "balances" && method === "GET") return json(await balances(wallet));
    const authenticated = { ...context, wallet, session };
    for (const handler of [contactsRoute, paymentsRoute, chatRoute]) {
      const response = await handler(authenticated);
      if (response) return response;
    }
    throw new AppError("Endpoint not found.", 404);
  } catch (e) {
    if (e instanceof AppError) return json({ error: e.message }, e.status);
    if (e instanceof z.ZodError)
      return json({ error: "Invalid input. Check the amount, address and required fields." }, 400);
    return json(
      { error: "The request could not complete. Check the network and configuration, then retry." },
      503,
    );
  }
}
