export const actions = [
  ["chat", "Ask Pollenstocks"],
  ["create", "Create account"],
  ["balance", "View balance"],
  ["send", "Send payment"],
  ["receive", "Receive payment"],
  ["history", "Recent activity"],
  ["contacts", "Manage contacts"],
  ["help", "Help & settings"],
] as const;
export const text = (body: string) => ({ type: "text", text: { body } });
export const capabilities = [
  "Hi, I’m Pollenstocks 👋",
  "",
  "📈 Buy and sell NVIDIA, Circle, GameStop and AMC",
  "💸 Send USDC to contacts and phone numbers",
  "📋 Check balances and recent activity",
  "",
  "Everything uses USDC on Arc, including network fees.",
  "Payments and trades require confirmation.",
].join("\n");
export function menu(hasAccount = false) {
  return {
    type: "interactive",
    interactive: {
      type: "list",
      body: {
        text:
          capabilities +
          (hasAccount
            ? "\n\nChoose a shortcut, or Ask Pollenstocks to chat. OpenServ processes chat messages, recent context and task details."
            : "\n\nChoose Create account to begin."),
      },
      action: {
        button: "Open menu",
        sections: [
          {
            title: "Pollenstocks",
            rows: actions.map(([id, title]) => ({
              id: "menu:" + id,
              title: id === "create" && hasAccount ? "My account" : title,
            })),
          },
        ],
      },
    },
  };
}
export function actionFor(input: string) {
  const command = input.trim().toLowerCase().replace(/^\//, "");
  if (
    [
      "balance",
      "my balance",
      "check balance",
      "what is my balance",
      "what is my balance?",
      "show my balance",
      "how much do i have",
      "how much do i have?",
    ].includes(command)
  )
    return "balance";
  if (["recent", "activity", "history"].includes(command)) return "history";
  const action = actions.find(
    ([id, label], index) =>
      command === "menu:" + id || command === label.toLowerCase() || command === String(index + 1),
  )?.[0];
  return action;
}
export function reply(input: string) {
  const command = input.trim().toLowerCase().replace(/^\//, "");
  const action = actionFor(input);
  if (action === "create")
    return text(
      "Create your Pollenstocks account to get a mainnet wallet. Transactions require your confirmation. Type Menu to begin.",
    );
  if (action === "help" || command === "help")
    return text(
      "Help\n\n• Payments: review, then confirm.\n• Contacts: save names and addresses.\n• Phone payments: recipient lookup must be enabled.\n• Limits: 1,000 USDC per payment.\n\nMainnet payments use real USDC. Never share wallet secrets.\nType Menu to return.",
    );
  if (action === "chat")
    return text("Create your account first, then choose Ask Pollenstocks to chat.");
  if (action)
    return text(
      "This feature needs a Pollenstocks wallet. Wallet setup is not available yet, and no payment has been prepared or sent. Type Menu to return.",
    );
  return menu();
}
