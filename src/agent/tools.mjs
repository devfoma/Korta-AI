// Korta's six tools. The AI brain and the scripted brain call the SAME tools, so the rules,
// the checks and what the dashboard shows are identical whichever brain runs.
//
// Money only moves in two places, both through the wallet's rules:
//   buy_quote / buy_demand_signal → small automatic data purchases
//   propose_order → owner approval → THEN code (not the AI) pays the supplier invoice
import { loadShop, recordPaidOrder, recordDataPurchase } from "../store/shop.mjs";
import { stockReport, stockSummaryForAgent } from "./stock.mjs";
import { checkBudget } from "./budget.mjs";
import { evaluateOffer, rankOffers } from "./choose.mjs";

import { config } from "../config.mjs";

const cents = (n) => Math.round(n * 100) / 100;
const CATEGORIES = ["staples", "household", "beverages"];

export const TOOL_DEFINITIONS = [
  {
    name: "check_stock",
    description: "Free. The shop's stock vs its sales: which items run out before a delivery could arrive, how many packs to order, and whether sales are unusual this week. Call again after buying a demand signal to update quantities.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_suppliers",
    description: "Free. Suppliers in the network and the categories they sell. Prices and delivery times are only in quotes.",
    parameters: { type: "object", properties: { category: { type: "string", enum: CATEGORIES } }, additionalProperties: false },
  },
  {
    name: "buy_demand_signal",
    description: "PAID (about $0.005 USDC). Local demand outlook for a category, e.g. a festive spike. Only worth buying when sales look unusual.",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", enum: CATEGORIES },
        reason: { type: "string", description: "One sentence: why this is worth its price." },
      },
      required: ["category", "reason"],
      additionalProperties: false,
    },
  },
  {
    name: "buy_quote",
    description: "PAID (about $0.002 USDC). A supplier's live prices, stock and delivery time for the items you need. Your wallet may refuse; if so, don't retry.",
    parameters: {
      type: "object",
      properties: {
        supplierId: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { itemId: { type: "string" }, packs: { type: "integer", minimum: 1 } },
            required: ["itemId", "packs"],
            additionalProperties: false,
          },
        },
        reason: { type: "string", description: "One sentence: why this quote is worth its price." },
      },
      required: ["supplierId", "items", "reason"],
      additionalProperties: false,
    },
  },
  {
    name: "check_budget",
    description: "Free. Whether an order total fits the owner's cash rules.",
    parameters: { type: "object", properties: { totalUsd: { type: "number" } }, required: ["totalUsd"], additionalProperties: false },
  },
  {
    name: "propose_order",
    description: "Free. Send ONE order recommendation to the owner, who approves or declines. If approved, it is paid automatically and you get the receipt. Only once per run.",
    parameters: {
      type: "object",
      properties: {
        supplierId: { type: "string" },
        quoteId: { type: "string", description: "A quoteId you bought this run from this supplier." },
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: { itemId: { type: "string" }, packs: { type: "integer", minimum: 1 } },
            required: ["itemId", "packs"],
            additionalProperties: false,
          },
        },
        reason: { type: "string", description: "2 short sentences for the owner: why this supplier, and the trade-off vs the alternatives." },
      },
      required: ["supplierId", "quoteId", "lines", "reason"],
      additionalProperties: false,
    },
  },
];

// One set of tools per restock run. approve(recommendation) → true | false | "timeout".
export function createTools({ wallet, emit, approve }) {
  const state = { suppliers: null, quotes: new Map(), multipliers: {}, report: null, decision: null };
  const shopItem = (id) => loadShop().items.find((i) => i.id === id);
  const needsFor = (lines) => lines.map((l) => ({
    itemId: l.itemId, packs: l.packs,
    daysOfCover: state.report?.items.find((i) => i.id === l.itemId)?.daysOfCover ?? null,
  }));

  async function directory() {
    if (state.suppliers) return state.suppliers;
    const r = await wallet.getFree("Supplier directory", "/directory");
    if (!r.ok) throw new Error(`Supplier directory unavailable: ${r.reason}`);
    state.suppliers = r.data.suppliers;
    return state.suppliers;
  }

  const tools = {
    async check_stock() {
      state.report = stockReport(loadShop(), state.multipliers);
      const summary = stockSummaryForAgent(state.report);
      emit({ type: "stock", report: state.report, note: summary.note });
      return summary;
    },

    async list_suppliers({ category } = {}) {
      const all = await directory();
      const suppliers = all.filter((s) => !category || s.categories.includes(category))
        .map(({ id, name, area, categories }) => ({ id, name, area, categories }));
      return { suppliers, note: "Prices, stock and delivery days are in each supplier's quote (paid)." };
    },

    async buy_demand_signal({ category, reason }) {
      if (!CATEGORIES.includes(category)) return { error: `Unknown category. Use one of: ${CATEGORIES.join(", ")}.` };
      const r = await wallet.buyData(reason || `Demand outlook for ${category}`, `/market/demand?category=${encodeURIComponent(category)}&area=Lagos`);
      if (!r.ok) return { refused: true, reason: r.reason, note: "Do not retry. Continue with what you have." };
      recordDataPurchase(r.payment);
      state.multipliers[category] = r.data.multiplier;
      emit({ type: "demand", url: r.payment.url, multiplier: r.data.multiplier, reason: r.data.reason });
      return { ...r.data, next: "Call check_stock again so the quantities include this outlook." };
    },

    async buy_quote({ supplierId, items, reason }) {
      const supplier = (await directory()).find((s) => s.id === supplierId);
      if (!supplier) return { error: "Unknown supplierId. Use list_suppliers." };
      const list = (Array.isArray(items) ? items : []).filter((i) => shopItem(i.itemId) && Number.isInteger(i.packs) && i.packs > 0);
      if (!list.length) return { error: "No valid items. Use itemIds and packs from check_stock." };
      const query = list.map((i) => `${i.itemId}:${i.packs}`).join(",");
      const r = await wallet.buyData(reason || `Quote from ${supplier.name}`, `/suppliers/${supplierId}/quote?items=${query}`);
      if (!r.ok) return { refused: true, reason: r.reason, note: "Do not retry. Continue with what you have." };
      recordDataPurchase(r.payment);
      const q = r.data;
      state.quotes.set(q.quoteId, q);
      emit({ type: "offer", url: r.payment.url, quote: q });
      return {
        quoteId: q.quoteId, supplierId: q.supplierId, supplier: q.supplier, deliveryDays: q.deliveryDays,
        lines: q.lines.map(({ itemId, packs, unitPriceUsd, available, inStock, reason: why }) => ({ itemId, packs, unitPriceUsd, available, inStock, ...(why ? { note: why } : {}) })),
        totalUsd: q.totalUsd, allInStock: q.allInStock,
        // Supplier text is untrusted data, labelled as such for the model.
        supplierNote_untrusted: q.note || "",
      };
    },

    async check_budget({ totalUsd }) {
      const total = Number(totalUsd);
      if (!(total > 0)) return { error: "totalUsd must be a positive number." };
      return checkBudget({ totalUsd: total, walletUsdc: await wallet.balance(), policy: config.policy });
    },

    async propose_order({ supplierId, quoteId, lines, reason }) {
      if (state.decision) return { error: "You already proposed an order this run and the owner decided. Write your final answer now." };
      const quote = state.quotes.get(quoteId);
      if (!quote || quote.supplierId !== supplierId) return { error: "Use a quoteId you bought this run from that same supplier." };

      // Every line must be on the quote, in stock, priced.
      const priced = [];
      for (const l of Array.isArray(lines) ? lines : []) {
        const q = quote.lines.find((x) => x.itemId === l.itemId);
        if (!q || q.unitPriceUsd == null || !Number.isInteger(l.packs) || l.packs < 1 || l.packs > q.available)
          return { error: `${l.packs} × ${l.itemId} isn't available on this quote.` };
        const item = shopItem(l.itemId);
        priced.push({ itemId: l.itemId, name: item.name, pack: item.pack, packs: l.packs, unitPriceUsd: q.unitPriceUsd, lineTotalUsd: cents(l.packs * q.unitPriceUsd) });
      }
      if (!priced.length) return { error: "No order lines." };

      // Guardrail in code: don't pick a supplier that arrives after the shelf is empty when another can make it.
      const needs = needsFor(priced);
      const chosen = evaluateOffer(quote, needs);
      const others = rankOffers([...state.quotes.values()].filter((q) => q.supplierId !== supplierId), needs);
      const betterOnTime = others.find((o) => o.onTime && o.complete);
      if (!chosen.onTime && betterOnTime)
        return { error: `${quote.supplier} delivers in ${quote.deliveryDays} days but stock runs out in ${chosen.runsOutIn}. ${betterOnTime.supplier} can deliver in time. Reconsider.` };

      const totalUsd = cents(priced.reduce((s, l) => s + l.lineTotalUsd, 0));
      const balance = await wallet.balance();
      const budget = checkBudget({ totalUsd, walletUsdc: balance, policy: config.policy });
      if (!budget.fits) return { error: budget.reason, shortfallUsd: budget.shortfallUsd, hint: "Reduce quantities (keep the fastest movers) and propose again." };

      const atRisk = state.report?.items.filter((i) => i.atRisk).map((i) => i.id) ?? [];
      const recommendation = {
        supplierId, supplier: quote.supplier, area: quote.area, quoteId, deliveryDays: quote.deliveryDays,
        lines: priced, totalUsd, walletUsdc: balance, walletAfterUsd: cents(balance - totalUsd),
        reason: String(reason || "").slice(0, 400),
        notCovered: atRisk.filter((id) => !priced.some((l) => l.itemId === id)),
        comparison: rankOffers([...state.quotes.values()], needs),
        dataSpentUsd: wallet.dataSpentUsd(),
      };
      emit({ type: "recommendation", recommendation });

      const answer = await approve(recommendation);
      if (answer !== true) {
        state.decision = { approved: false, reason: answer === "timeout" ? "no answer in time" : "declined by the owner" };
        emit({ type: "decision", ...state.decision });
        return { approved: false, reason: state.decision.reason };
      }
      emit({ type: "decision", approved: true });

      // Approved: code creates the order and pays the invoice. The wallet re-checks every rule.
      const created = await wallet.postFree(`/suppliers/${supplierId}/orders`, { quoteId, lines: priced.map(({ itemId, packs }) => ({ itemId, packs })) });
      if (!created.ok) {
        state.decision = { approved: true, paid: false, reason: created.reason };
        return state.decision;
      }
      const order = created.data;
      const paid = await wallet.payInvoice(`Pay ${quote.supplier} invoice ${order.orderId}`, order.payPath, totalUsd);
      if (!paid.ok) {
        state.decision = { approved: true, paid: false, reason: paid.reason };
        emit({ type: "unpaid", reason: paid.reason, order });
        return { ...state.decision, note: "Nothing was paid. Tell the owner why." };
      }
      const shop = recordPaidOrder({ supplier: { id: supplierId, name: quote.supplier }, order, lines: priced, tx: paid.payment.tx, link: paid.payment.link });
      state.decision = { approved: true, paid: true, orderId: order.orderId, totalUsd: order.totalUsd, deliveryDate: order.deliveryDate, tx: paid.payment.tx, link: paid.payment.link };
      emit({ type: "records", order: state.decision, items: stockReport(shop, state.multipliers).items });
      return state.decision;
    },
  };

  const supplierName = (id) => state.suppliers?.find((s) => s.id === id)?.name ?? `supplier ${id}`;
  const LABELS = {
    check_stock: () => "Checking stock against sales",
    list_suppliers: () => "Looking up suppliers (free)",
    buy_demand_signal: (a) => `Buying the ${a.category} demand outlook`,
    buy_quote: (a) => `Buying a quote from ${supplierName(a.supplierId)}`,
    check_budget: (a) => `Checking ${a.totalUsd} USDC against your cash rules`,
    propose_order: () => "Preparing a recommendation for you",
  };

  async function run(name, args = {}) {
    const fn = tools[name];
    if (!fn) return { error: `Unknown tool: ${name}` };
    emit({ type: "tool", name, args, label: LABELS[name]?.(args) ?? name });
    try {
      return await fn(args);
    } catch (e) {
      emit({ type: "error", url: name, message: e.message });
      return { error: e.message };
    }
  }

  return { run, state };
}
