import { z } from "zod";
import { settings } from "@/server/config";
import { store } from "@/server/store";
import { chat } from "@/server/serv";
import { json } from "../http";
import type { AuthenticatedContext } from "../types";
export async function chatRoute({ path, method, body, wallet, session }: AuthenticatedContext) {
  if (path[0] === "chat") {
    if (method === "GET") return json(store().messages(wallet, settings().chain.id));
    if (method === "POST") {
      const { message } = z
        .object({ message: z.string().trim().min(1).max(1500) })
        .strict()
        .parse(body);
      store().lockChat(session.id);
      try {
        return json(await chat(wallet, message));
      } finally {
        store().unlockChat(session.id);
      }
    }
  }
  return null;
}
