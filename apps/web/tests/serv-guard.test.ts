import assert from "node:assert/strict";
import test from "node:test";
import { responseMessage } from "../src/server/whatsapp/assistant-inference";
import {
  chatCompletionRefused,
  promptGuardChatTool,
  promptGuardResponsesTool,
  ServRefusal,
} from "../src/server/serv-guard";

// Shapes observed from live SERV prompt-guard refusals on 2026-09-26.
const refusedResponse = {
  id: "resp_x",
  object: "response",
  status: "incomplete",
  incomplete_details: { reason: "content_filter" },
  output: [
    {
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "I can't share that." }],
    },
  ],
  output_text: "I can't share that.",
};
const refusedChat = {
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "I can't share that." },
      finish_reason: "content_filter",
    },
  ],
};

test("guard markers use each endpoint's tool format", () => {
  assert.deepEqual(promptGuardChatTool, {
    type: "function",
    function: { name: "serv_prompt_guard" },
  });
  assert.deepEqual(promptGuardResponsesTool, { type: "function", name: "serv_prompt_guard" });
});

test("responses refusal is never returned as a model answer", () => {
  assert.throws(() => responseMessage(refusedResponse), ServRefusal);
});

test("other incomplete responses stay generic failures", () => {
  assert.throws(
    () =>
      responseMessage({
        ...refusedResponse,
        incomplete_details: { reason: "max_output_tokens" },
      }),
    (error: unknown) =>
      !(error instanceof ServRefusal) && (error as Error).message === "serv_incomplete",
  );
});

test("completed responses still return tool calls", () => {
  const message = responseMessage({
    status: "completed",
    incomplete_details: null,
    output: [{ type: "function_call", name: "get_balances", arguments: "{}" }],
  });
  assert.equal(message.tool_calls[0].function.name, "get_balances");
});

test("chat completion refusal is detected by finish reason", () => {
  assert.equal(chatCompletionRefused(refusedChat), true);
  assert.equal(
    chatCompletionRefused({ choices: [{ message: { content: "Hi" }, finish_reason: "stop" }] }),
    false,
  );
  assert.equal(chatCompletionRefused({}), false);
  assert.equal(chatCompletionRefused(null), false);
});
