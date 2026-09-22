export const actions = [
  ["create", "Create account"],
  ["balance", "View balance"],
  ["send", "Send payment"],
  ["receive", "Receive payment"],
  ["history", "Recent activity"],
  ["contacts", "Manage contacts"],
  ["chat", "Ask Steward"],
  ["help", "Help & settings"],
] as const;
export const text = (body: string) => ({ type: "text", text: { body } });
export function menu(hasAccount = false) {
  return {
    type: "interactive",
    interactive: {
      type: "list",
      body: {
        text: "Welcome to Steward 👋\nYour WhatsApp payment assistant.\n\nRobinhood Chain testnet · Demo USD has no monetary value. View your balance, receive funds, or review a Demo USD payment.\n\nChoose an option to learn more.",
      },
      action: {
        button: "Open menu",
        sections: [
          {
            title: "Steward",
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
      "Steward accounts will have a wallet controlled by Steward for testnet payments. Demo USD has no monetary value. Account creation is not available yet; no account or wallet has been created. Type Menu to return.",
    );
  if (action === "help" || command === "help")
    return text(
      "Steward is a testnet payment prototype. Create your account and wallet, view your balance, or send Demo USD to a wallet address after reviewing and confirming in WhatsApp. Manage contacts to save names and wallet addresses. Recipients can enable phone-number payments in Help & settings. Limits: 1,000 Demo USD per payment and 5,000 per rolling 24 hours. Never share a seed phrase or private key. Type Menu to return.",
    );
  if (action === "chat")
    return text(
      "Create your Steward account first, then choose Ask Steward to review the chat opt-in. Type Menu to return.",
    );
  if (action)
    return text(
      "This feature needs a Steward wallet. Wallet setup is not available yet, and no payment has been prepared or sent. Type Menu to return.",
    );
  return menu();
}
