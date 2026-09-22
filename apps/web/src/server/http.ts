import { NextRequest, NextResponse } from "next/server";
import { settings } from "@/server/config";
import { AppError } from "@/lib/shared";

// Shared HTTP limits, JSON responses, and secure session cookies.
const rates = new Map<string, { count: number; until: number }>();
export function limited(key: string) {
  const now = Date.now();
  if (rates.size > 5000) for (const [k, v] of rates) if (v.until < now) rates.delete(k);
  const bucket = rates.get(key);
  if (!bucket || bucket.until < now) {
    rates.set(key, { count: 1, until: now + 60_000 });
    return;
  }
  if (++bucket.count > 60) throw new AppError("Too many requests. Please wait a minute.", 429);
}
export async function readBody(req: NextRequest): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) return {};
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    size += item.value.byteLength;
    if (size > 12_000) {
      await reader.cancel();
      throw new AppError("Request is too large.", 413);
    }
    chunks.push(item.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError("Invalid JSON request.");
  }
}
export const json = (value: unknown, status = 200) =>
  NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
export function cookie(response: NextResponse, name: string, value: string, maxAge: number) {
  response.cookies.set(name, value, {
    httpOnly: true,
    sameSite: "strict",
    secure: settings().origin.startsWith("https:"),
    path: "/",
    maxAge,
  });
  return response;
}
