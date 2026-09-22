import { handleRequest } from "@/server/router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handleRequest;
export const POST = handleRequest;
export const DELETE = handleRequest;
