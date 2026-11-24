// The scripted brain: the same tools and rules, decided by fixed logic instead of an AI model.
// It keeps the demo working if the AI is down, and shows the safety lives in the wallet, not the AI.
import { rankOffers } from "./choose.mjs";

const say = (emit, text) => emit({ type: "thought", text });

export async function runScriptedBrain(_task, toolbox, emit) {
  let stock = await toolbox.run("check_stock");
  if (!stock.atRisk?.length) return { summary: "Everything has enough cover. Nothing to restock today, and nothing spent." };

  // Buy the demand signal only when sales look unusual.
  if (stock.unusualDemand) {
    const categories = [...new Set(stock.atRisk.map((i) => i.category))];
    for (const category of categories) {
      say(emit, `Sales of ${category} are unusual this week, so a demand outlook is worth $0.005.`);
      await toolbox.run("buy_demand_signal", { category, reason: `Sales are unusual this week; check the ${category} demand outlook before sizing the order.` });
    }
    stock = await toolbox.run("check_stock");
  } else {
    say(emit, "Sales are steady, so I'm skipping the demand signal.");
  }

  const items = stock.atRisk.map((i) => ({ itemId: i.itemId, packs: i.suggestedPacks }));
  const categories = new Set(stock.atRisk.map((i) => i.category));
  const { suppliers } = await toolbox.run("list_suppliers");
  const quotes = [];
  for (const s of suppliers.filter((s) => s.categories.some((c) => categories.has(c)))) {
    const q = await toolbox.run("buy_quote", { supplierId: s.id, items, reason: `Compare ${s.name}'s price, stock and delivery time.` });
    if (q.quoteId) quotes.push(toolbox.state.quotes.get(q.quoteId));
  }
  if (!quotes.length) return { summary: "I couldn't get any supplier quotes, so nothing was ordered." };

  const needs = stock.atRisk.map((i) => ({ itemId: i.itemId, packs: i.suggestedPacks, daysOfCover: i.daysOfCover }));
  const [best, ...rest] = rankOffers(quotes, needs);
  let lines = needs.filter((n) => !best.missing.includes(n.itemId)).map(({ itemId, packs }) => ({ itemId, packs }));

  // Fit the cash rules: trim the slowest mover one pack at a time.
  const quote = toolbox.state.quotes.get(best.quoteId);
  const priceOf = (id) => quote.lines.find((l) => l.itemId === id).unitPriceUsd;
  const total = () => Math.round(lines.reduce((s, l) => s + l.packs * priceOf(l.itemId), 0) * 100) / 100;
  let budget = await toolbox.run("check_budget", { totalUsd: total() });
  while (!budget.fits && lines.some((l) => l.packs > 0)) {
    const slowest = [...lines].filter((l) => l.packs > 0).sort((a, b) =>
      (stock.atRisk.find((i) => i.itemId === b.itemId).daysOfCover) - (stock.atRisk.find((i) => i.itemId === a.itemId).daysOfCover))[0];
    slowest.packs -= 1;
    lines = lines.filter((l) => l.packs > 0);
    if (!lines.length) break;
    budget = await toolbox.run("check_budget", { totalUsd: total() });
  }
  if (!lines.length) return { summary: "No order fits your cash rules right now, so nothing was ordered." };

  const cheaper = rest.find((o) => o.complete && o.totalUsd < best.totalUsd);
  const reason = [
    `${best.supplier} delivers in ${best.deliveryDays} day${best.deliveryDays === 1 ? "" : "s"}, before you run out in ${best.runsOutIn}.`,
    cheaper ? `${cheaper.supplier} is ${(best.totalUsd - cheaper.totalUsd).toFixed(2)} USDC cheaper but delivers in ${cheaper.deliveryDays} days.` : "It's the best complete offer.",
  ].join(" ");

  const result = await toolbox.run("propose_order", { supplierId: best.supplierId, quoteId: best.quoteId, lines, reason });
  if (result.error) return { summary: `I couldn't place the order: ${result.error}` };
  if (!result.approved) return { summary: `You ${result.reason === "no answer in time" ? "didn't answer in time" : "declined"}, so nothing was ordered.` };
  if (!result.paid) return { summary: `You approved, but the payment didn't go through: ${result.reason}. Nothing was paid.` };
  return { summary: `Ordered from ${best.supplier} for ${result.totalUsd} USDC, arriving ${result.deliveryDate}. Receipt: ${result.link}` };
}
