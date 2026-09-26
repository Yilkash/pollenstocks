import { z } from "zod";

// Keep the local tool dispatcher independent of the provider's response envelope.
// Reasoning output is deliberately excluded from user replies and stored history.
export function responseMessage(body: unknown) {
  const result = z
    .object({
      status: z.string().optional(),
      output_text: z.string().nullable().optional(),
      output: z
        .array(
          z.object({
            type: z.string(),
            role: z.string().optional(),
            name: z.string().optional(),
            arguments: z.string().optional(),
            content: z
              .array(
                z.object({
                  type: z.string(),
                  text: z.string().optional(),
                }),
              )
              .optional(),
          }),
        )
        .default([]),
    })
    .parse(body);
  if (result.status && result.status !== "completed") throw Error("serv_incomplete");
  const tool_calls = result.output
    .filter((item) => item.type === "function_call")
    .map((item) => ({ function: { name: item.name, arguments: item.arguments } }));
  const content =
    result.output
      .filter((item) => item.type === "message" && item.role === "assistant")
      .flatMap((item) => item.content ?? [])
      .filter((part) => part.type === "output_text")
      .map((part) => part.text ?? "")
      .join("\n") ||
    result.output_text ||
    null;
  if (!content && !tool_calls.length) throw Error("serv_empty_response");
  return { content, tool_calls };
}
