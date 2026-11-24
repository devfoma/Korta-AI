// Offline scenario tests: the real tools and the scripted brain against a fake wallet that
// answers like the Supplier Network (same catalog, same quote and invoice logic), with no
// network and no money. The AI brain is tested on testnet by the eval suite instead.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

process.env.KORTA_SHOP_FILE = path.join(os.tmpdir(), `korta-test-shop-${process.pid}.json`);
const { resetShop, loadShop, saveShop } = await import("../src/store/shop.mjs");
const { createTools } = await import("../src/agent/tools.mjs");
const { runScriptedBrain } = await import("../src/agent/brain-scripted.mjs");
const { suppliersFor, buildQuote, orderTotal, demandFor } = await import("../src/suppliers/catalog.mjs");

function fakeWallet({ scenario = "default", balanceUsd = 20, balanceFailures = 0 } = {}) {
  let failuresLeft = balanceFailures;
  const suppliers = suppliersFor(scenario);
  const quotes = new Map();
  const payments = [];
  let dataUsd = 0;
  let n = 0;
  let lastOrder = null;
  const pay = (kind, why, priceUsd) => {
    const tx = `tx${++n}`;
    const p = { kind, why, priceUsd, paid: true, tx, link: `https://explorer.test/tx/${tx}` };
    payments.push(p);
    return p;
  };
  return {
    payments,
    balance: async () => {
      if (failuresLeft-- > 0) throw new Error("fetch failed");
      return balanceUsd;
    },
    dataSpentUsd: () => dataUsd,
    async getFree() {
      return { ok: true, data: { suppliers: Object.values(suppliers).map(({ id, name, area, categories }) => ({ id, name, area, categories })) } };
    },
    async buyData(why, p) {
      const url = new URL(p, "http://x");
      if (url.pathname === "/market/demand") {
        dataUsd += 0.005;
        return { ok: true, data: { category: url.searchParams.get("category"), ...demandFor(scenario) }, payment: pay("data", why, 0.005) };
      }
      const id = url.pathname.split("/")[2];
      const wanted = url.searchParams.get("items").split(",").map((x) => { const [itemId, packs] = x.split(":"); return { itemId, packs: Number(packs) }; });
      const q = { quoteId: `q${++n}`, ...buildQuote(suppliers[id], wanted) };
      quotes.set(q.quoteId, q);
      dataUsd += 0.002;
      return { ok: true, data: q, payment: pay("data", why, 0.002) };
    },
    async postFree(p, body) {
      const id = p.split("/")[2];
      const q = quotes.get(body.quoteId);
      const lines = body.lines.map((l) => ({ ...l, unitPriceUsd: q.lines.find((x) => x.itemId === l.itemId).unitPriceUsd }));
      lastOrder = { orderId: `ord${++n}`, supplierId: id, totalUsd: orderTotal(lines, scenario, id), deliveryDate: "2026-11-25", payPath: `${p}/ord${n}/pay` };
      return { ok: true, data: lastOrder };
    },
    // Mirrors the real wallet's order rule that matters offline: never pay more than was approved.
    async payInvoice(why, _p, approvedUsd) {
      if (lastOrder.totalUsd > approvedUsd)
        return { ok: false, refused: true, reason: `price changed: the invoice is $${lastOrder.totalUsd} but the owner approved $${approvedUsd}` };
      return { ok: true, data: {}, payment: pay("order", why, lastOrder.totalUsd) };
    },
  };
}

async function run({ scenario, balanceUsd, balanceFailures, approve = true } = {}) {
  const wallet = fakeWallet({ scenario, balanceUsd, balanceFailures });
  const events = [];
  const toolbox = createTools({ wallet, emit: (e) => events.push(e), approve: async () => approve });
  const { summary } = await runScriptedBrain(undefined, toolbox, (e) => events.push(e));
  const rec = events.find((e) => e.type === "recommendation")?.recommendation;
  return { summary, rec, decision: toolbox.state.decision, wallet, events, toolbox };
}

const lines = (rec) => Object.fromEntries(rec.lines.map((l) => [l.itemId, l.packs]));
const bought = (wallet, re) => wallet.payments.filter((p) => p.paid && re.test(p.why)).length;

beforeEach(() => resetShop());

test("default: picks Bola (on time) over cheaper-but-slow Adeyemi, 4 bags + 2 cartons = 4.20", async () => {
  const { rec, decision, wallet } = await run();
  assert.equal(rec.supplierId, "b");
  assert.deepEqual(lines(rec), { rice: 4, oil: 2 });
  assert.equal(rec.totalUsd, 4.2);
  assert.match(rec.reason, /Adeyemi Wholesale is 0.30 USDC cheaper but delivers in 4 days/);
  assert.equal(decision.paid, true);
  assert.equal(bought(wallet, /demand outlook/), 1, "buys the demand signal (sales are unusual)");
  assert.equal(wallet.payments.filter((p) => p.kind === "data").length, 4, "1 demand signal + 3 quotes");
});

test("all-fast: everyone delivers tomorrow, so the cheapest (Adeyemi, 3.90) wins", async () => {
  const { rec } = await run({ scenario: "all-fast" });
  assert.equal(rec.supplierId, "a");
  assert.equal(rec.totalUsd, 3.9);
});

test("b-out-of-rice: switches to Coastline, never proposes unavailable stock", async () => {
  const { rec } = await run({ scenario: "b-out-of-rice" });
  assert.equal(rec.supplierId, "c");
  assert.deepEqual(lines(rec), { rice: 4, oil: 2 });
});

test("price-jump: approved at 4.20, invoice says 4.62, nothing is paid", async () => {
  const { decision, wallet, summary } = await run({ scenario: "price-jump" });
  assert.equal(decision.approved, true);
  assert.equal(decision.paid, false);
  assert.match(decision.reason, /price changed/);
  assert.equal(wallet.payments.filter((p) => p.kind === "order").length, 0);
  assert.match(summary, /Nothing was paid/);
});

test("declined: no order is paid and records don't change", async () => {
  const { decision, wallet } = await run({ approve: false });
  assert.equal(decision.approved, false);
  assert.equal(wallet.payments.filter((p) => p.kind === "order").length, 0);
  assert.equal(loadShop().orders.length, 0);
});

test("approved: stock shows incoming and the order is recorded", async () => {
  await run();
  const shop = loadShop();
  assert.equal(shop.orders.length, 1);
  assert.equal(shop.items.find((i) => i.id === "rice").incoming, 200);
  assert.equal(shop.items.find((i) => i.id === "oil").incoming, 24);
});

test("cash reserve: with 5 USDC and a 2 USDC reserve, the order shrinks to fit", async () => {
  const { rec, decision } = await run({ balanceUsd: 5 });
  assert.ok(rec.totalUsd <= 3, `total ${rec.totalUsd} must leave the 2 USDC reserve`);
  assert.deepEqual(lines(rec), { rice: 3, oil: 1 }, "trims evenly: 2.90 USDC, both items keep cover (rice 10.5 days, oil 9)");
  assert.match(rec.reason, /Trimmed to keep your cash reserve/);
  assert.equal(decision.paid, true);
});

test("network blip on the balance check: retried, and the order is NOT shrunk", async () => {
  const { rec, decision } = await run({ balanceFailures: 1 });
  assert.deepEqual(lines(rec), { rice: 4, oil: 2 });
  assert.equal(decision.paid, true);
});

test("balance unreachable: no order is proposed (unknown is not 'doesn't fit')", async () => {
  const { rec, decision, summary, wallet } = await run({ balanceFailures: Infinity });
  assert.equal(rec, undefined);
  assert.equal(decision, null);
  assert.match(summary, /couldn't check your wallet balance/);
  assert.equal(wallet.payments.filter((p) => p.kind === "order").length, 0);
});

test("steady sales: skips the demand signal and saves the money", async () => {
  const shop = loadShop();
  const dates = [...new Set(shop.sales.map((s) => s.date))].sort().slice(-14);
  for (const s of shop.sales) if (dates.includes(s.date)) s.qty = s.itemId === "rice" ? 20 : s.itemId === "oil" ? 2 : s.qty;
  saveShop(shop);
  const { rec, wallet } = await run();
  assert.equal(bought(wallet, /demand outlook/), 0);
  assert.deepEqual(lines(rec), { rice: 3, oil: 2 }, "normal quantities without a festive multiplier");
});

test("guardrail in code: proposing a supplier that arrives too late is rejected when another is on time", async () => {
  const wallet = fakeWallet();
  const toolbox = createTools({ wallet, emit: () => {}, approve: async () => true });
  await toolbox.run("check_stock");
  const items = [{ itemId: "rice", packs: 3 }, { itemId: "oil", packs: 2 }];
  const a = await toolbox.run("buy_quote", { supplierId: "a", items, reason: "test" });
  await toolbox.run("buy_quote", { supplierId: "b", items, reason: "test" });
  const out = await toolbox.run("propose_order", { supplierId: "a", quoteId: a.quoteId, lines: items, reason: "cheapest" });
  assert.match(out.error, /delivers in 4 days but stock runs out in 3.*Bola Foods Depot can deliver in time/);
  assert.equal(toolbox.state.decision, null, "nothing reached the owner");
});

test("propose_order refuses quotes that weren't bought this run", async () => {
  const toolbox = createTools({ wallet: fakeWallet(), emit: () => {}, approve: async () => true });
  const out = await toolbox.run("propose_order", { supplierId: "b", quoteId: "made-up", lines: [{ itemId: "rice", packs: 4 }], reason: "x" });
  assert.match(out.error, /quoteId you bought this run/);
});
