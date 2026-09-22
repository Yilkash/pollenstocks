import { z } from "zod";
import { store } from "@/server/store";
import { address } from "@/lib/shared";
import { json } from "../http";
import type { AuthenticatedContext } from "../types";
export async function contactsRoute({ path, method, body, wallet }: AuthenticatedContext) {
  if (path[0] === "contacts") {
    if (method === "GET") return json(store().contacts(wallet));
    if (method === "POST") {
      const input = z
        .object({
          name: z
            .string()
            .trim()
            .min(1)
            .max(40)
            .regex(/^[a-zA-Z0-9][a-zA-Z0-9 ._-]*$/),
          address: z.string(),
        })
        .strict()
        .parse(body);
      return json(
        store().addContact(wallet, { name: input.name, address: address(input.address) }),
        201,
      );
    }
    if (method === "DELETE") {
      const { name } = z
        .object({ name: z.string().max(40) })
        .strict()
        .parse(body);
      store().removeContact(wallet, name);
      return json({ ok: true });
    }
  }
  return null;
}
