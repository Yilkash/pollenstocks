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
const text = (body: string) => ({ type: "text", text: { body } });
export function menu() {
  return {
    type: "interactive",
    interactive: {
      type: "list",
      body: {
        text: "Welcome to Steward 👋\nYour WhatsApp payment assistant.\n\nRobinhood Chain testnet · Demo USD has no monetary value. Wallet features are being connected.\n\nChoose an option to learn more.",
      },
      action: {
        button: "Open menu",
        sections: [
          { title: "Steward", rows: actions.map(([id, title]) => ({ id: "menu:" + id, title })) },
        ],
      },
    },
  };
}
export function reply(input: string) {
  const command = input.trim().toLowerCase();
  const action = actions.find(
    ([id, label], index) =>
      command === "menu:" + id || command === label.toLowerCase() || command === String(index + 1),
  )?.[0];
  if (action === "create")
    return text(
      "Steward accounts will have a wallet controlled by Steward for testnet payments. Demo USD has no monetary value. Account creation is not available yet; no account or wallet has been created. Type Menu to return.",
    );
  if (action === "help" || command === "help")
    return text(
      "Steward is a testnet payment prototype. Planned features: send by saved name, registered phone number or wallet address, then review and confirm in WhatsApp. Wallet creation and payments are not available yet. Never share a seed phrase or private key. Type Menu to return.",
    );
  if (action === "chat")
    return text(
      "SERV chat is not connected to WhatsApp yet. The web assistant remains available. Type Menu to return.",
    );
  if (action)
    return text(
      "This feature needs a Steward wallet. Wallet setup is not available yet, and no payment has been prepared or sent. Type Menu to return.",
    );
  return menu();
}
