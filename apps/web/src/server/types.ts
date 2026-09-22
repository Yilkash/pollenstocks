import type { NextRequest } from "next/server";
import type { Address } from "viem";
type Session = { id: string; wallet: string };
export interface RequestContext {
  req: NextRequest;
  path: string[];
  method: string;
  body: unknown;
  sessionToken: string;
  session: Session | undefined;
}
export type AuthenticatedContext = RequestContext & { wallet: Address; session: Session };
