// SERV marker tools: SERV strips every serv_* tool before the model runs, so the
// model never sees or calls them. Declaring serv_prompt_guard enables SERV's
// input-side prompt-injection check; a blocked request never reaches the model.
// https://docs.openserv.ai/serv-reasoning/tutorials/prompt-guard
export const promptGuardChatTool = {
  type: "function",
  function: { name: "serv_prompt_guard" },
} as const;
export const promptGuardResponsesTool = { type: "function", name: "serv_prompt_guard" } as const;

// SERV returns an endpoint-shaped refusal (HTTP 200) for both the prompt guard and
// its always-on output content filter. Neither may be treated as a model answer.
export class ServRefusal extends Error {
  constructor() {
    super("serv_refusal");
    this.name = "ServRefusal";
  }
}

export function chatCompletionRefused(body: unknown) {
  const choice = (body as { choices?: { finish_reason?: unknown }[] } | null)?.choices?.[0];
  return choice?.finish_reason === "content_filter";
}
