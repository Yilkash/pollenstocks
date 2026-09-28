import { test, expect, type Page } from "@playwright/test";
const sender = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const token = "0x3333333333333333333333333333333333333333";
const hash = "0x" + "ab".repeat(32);
async function setup(page: Page) {
  const stats = { logout: 0, signins: 0, claims: 0, outcomes: [] as string[], attach: 0 };
  let payment: any = null;
  await page.addInitScript(
    ({ sender }) => {
      const handlers: Record<string, ((...args: any[]) => void)[]> = {};
      const w = window as any;
      w.fakeWallet = {
        accounts: [sender],
        chain: "0xb626",
        mode: "reject",
        sends: 0,
        signatures: 0,
        emit(name: string, value: any) {
          if (name === "accountsChanged") this.accounts = value;
          if (name === "chainChanged") this.chain = value;
          for (const f of handlers[name] || []) f(value);
        },
      };
      Object.defineProperty(window, "ethereum", {
        value: {
          on: (name: string, fn: any) => (handlers[name] ??= []).push(fn),
          removeListener: (name: string, fn: any) => {
            handlers[name] = (handlers[name] || []).filter((f) => f !== fn);
          },
          request: async ({ method }: any) => {
            const f = w.fakeWallet;
            if (method === "eth_accounts" || method === "eth_requestAccounts") return f.accounts;
            if (method === "eth_chainId") return f.chain;
            if (method === "wallet_switchEthereumChain") {
              f.chain = "0xb626";
              f.emit("chainChanged", f.chain);
              return null;
            }
            if (method === "personal_sign") {
              f.signatures++;
              return "0x" + "aa".repeat(65);
            }
            if (method === "eth_sendTransaction") {
              f.sends++;
              if (f.mode === "reject")
                throw Object.assign(new Error("User rejected"), { code: 4001 });
              if (f.mode === "unknown") throw new Error("Wallet transport timeout");
              return "0x" + "ab".repeat(32);
            }
            throw new Error("Unexpected wallet method: " + method);
          },
        },
        configurable: true,
      });
    },
    { sender },
  );
  // Every API request is intercepted: these browser checks never use real keys or wallets.
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.slice(5);
    const method = route.request().method();
    const body = route.request().postDataJSON();
    let data: any = {};
    if (path === "config")
      data = {
        chainId: 46630,
        chainName: "Test chain",
        token,
        explorer: null,
        rpcUrl: "http://127.0.0.1:3101",
        servReady: false,
      };
    else if (path === "session") {
      if (method === "DELETE") stats.logout++;
      data = { wallet: sender };
    } else if (path === "auth/challenge") {
      stats.signins++;
      data = { message: "Test sign-in" };
    } else if (path === "auth/verify") data = { wallet: sender };
    else if (path === "balances") data = { eth: "0.01", token: "995" };
    else if (path === "contacts") data = [];
    else if (path === "chat") data = [];
    else if (path === "payments" && method === "GET") data = payment ? [payment] : [];
    else if (path === "payments" && method === "POST") {
      payment = {
        id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        requestId: body.requestId,
        sender,
        recipient,
        recipientName: "Sila",
        token,
        chainId: 46630,
        amount: "5",
        amountBase: "5000000",
        note: "",
        gas: "50000",
        gasPrice: "1000000",
        nonce: null,
        createdAt: Date.now(),
        expiresAt: Date.now() + 300000,
        status: "draft",
        hash: null,
        error: null,
      };
      data = payment;
    } else if (path.endsWith("/claim")) {
      stats.claims++;
      payment = { ...payment, status: "signing", nonce: 2 };
      data = payment;
    } else if (path.endsWith("/outcome")) {
      stats.outcomes.push(body.status);
      payment = { ...payment, status: body.status };
      data = payment;
    } else if (path.endsWith("/submitted")) {
      stats.attach++;
      if (stats.attach === 1) {
        await route.fulfill({
          status: 503,
          json: { error: "Simulated interruption after broadcast" },
        });
        return;
      }
      payment = { ...payment, status: "included", hash: body.hash };
      data = payment;
    } else throw new Error("Unexpected API path: " + path);
    await route.fulfill({ json: data });
  });
  await page.goto("/testnet");
  await expect(page.getByRole("button", { name: /Disconnect/ })).toBeVisible();
  return stats;
}
async function prepare(page: Page) {
  await page.getByLabel("Send to", { exact: true }).fill(recipient);
  await page.getByLabel("Amount · Demo USD").fill("5");
  await page.getByRole("button", { name: "Review payment" }).click();
  await expect(page.getByRole("button", { name: "Approve in wallet" })).toBeEnabled();
}
test("same account/network events and reload preserve session without login prompts", async ({
  page,
}) => {
  const stats = await setup(page);
  await page.evaluate(() => {
    const f = (window as any).fakeWallet;
    for (let i = 0; i < 4; i++) {
      f.emit("accountsChanged", [f.accounts[0].toUpperCase().replace("0X", "0x")]);
      f.emit("chainChanged", "0xb626");
    }
  });
  await expect(page.getByRole("button", { name: /Disconnect/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: /Disconnect/ })).toBeVisible();
  expect(stats.logout).toBe(0);
  expect(stats.signins).toBe(0);
  expect(await page.evaluate(() => (window as any).fakeWallet.signatures)).toBe(0);
});
test("real account change clears private view without racing a session deletion", async ({
  page,
}) => {
  const stats = await setup(page);
  await page.evaluate(() =>
    (window as any).fakeWallet.emit("accountsChanged", [
      "0x2222222222222222222222222222222222222222",
    ]),
  );
  await expect(page.getByRole("button", { name: "Connect wallet", exact: true })).toBeVisible();
  await expect(page.getByText("995", { exact: true })).toHaveCount(0);
  expect(stats.logout).toBe(0);
});
test("temporary wallet lock reconnects using the existing signed session", async ({ page }) => {
  const stats = await setup(page);
  await page.evaluate(() => (window as any).fakeWallet.emit("accountsChanged", []));
  await expect(page.getByRole("button", { name: "Connect wallet", exact: true })).toBeVisible();
  await page.evaluate(
    ({ sender }) => {
      (window as any).fakeWallet.accounts = [sender];
    },
    { sender },
  );
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await expect(page.getByRole("button", { name: /Disconnect/ })).toBeVisible();
  expect(stats.signins).toBe(0);
  expect(stats.logout).toBe(0);
});
test("wallet rejection is recorded and duplicate approval clicks send only once", async ({
  page,
}) => {
  const stats = await setup(page);
  await prepare(page);
  await page
    .getByRole("button", { name: "Approve in wallet" })
    .evaluate((el: HTMLButtonElement) => {
      el.click();
      el.click();
    });
  await expect.poll(() => stats.outcomes).toContain("rejected");
  expect(stats.claims).toBe(1);
  expect(await page.evaluate(() => (window as any).fakeWallet.sends)).toBe(1);
});
test("ambiguous wallet error stays unknown instead of allowing another approval", async ({
  page,
}) => {
  const stats = await setup(page);
  await page.evaluate(() => {
    (window as any).fakeWallet.mode = "unknown";
  });
  await prepare(page);
  await page.getByRole("button", { name: "Approve in wallet" }).click();
  await expect.poll(() => stats.outcomes).toContain("unknown");
  await expect(page.getByRole("button", { name: "Approve in wallet" })).toHaveCount(0);
});
test("broadcast hash survives reload and recovers without a second wallet transaction", async ({
  page,
}) => {
  const stats = await setup(page);
  await page.evaluate(() => {
    (window as any).fakeWallet.mode = "success";
  });
  await prepare(page);
  await page.getByRole("button", { name: "Approve in wallet" }).click();
  await expect(page.locator(".alert[role=alert]")).toContainText("Simulated interruption");
  await page.reload();
  await page.getByRole("button", { name: "Sila ↗" }).click();
  await expect(page.getByRole("textbox", { name: "Transaction hash" })).toHaveValue(hash);
  await page.getByRole("button", { name: "Recover receipt" }).click();
  await expect(page.getByText("Included on chain", { exact: true })).toBeVisible();
  expect(stats.claims).toBe(1);
  expect(stats.attach).toBe(2);
  expect(await page.evaluate(() => (window as any).fakeWallet.sends)).toBe(0);
});

test("wrong network clears the view and switching back reuses the session", async ({ page }) => {
  const stats = await setup(page);
  await page.evaluate(() => (window as any).fakeWallet.emit("chainChanged", "0x1"));
  await expect(page.getByRole("button", { name: "Connect wallet", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await expect(page.getByRole("button", { name: /Disconnect/ })).toBeVisible();
  expect(stats.signins).toBe(0);
  expect(stats.logout).toBe(0);
});
test("explicit disconnect still revokes the session", async ({ page }) => {
  const stats = await setup(page);
  await page.getByRole("button", { name: /Disconnect/ }).click();
  await expect(page.getByRole("button", { name: "Connect wallet", exact: true })).toBeVisible();
  expect(stats.logout).toBe(1);
});
