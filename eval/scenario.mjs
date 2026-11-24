// One eval scenario in its own process, so each gets fresh config (e.g. a different cash reserve)
// and its own shop file. Spawned by eval/run.mjs; prints one result line for the parent to parse.
//   node eval/scenario.mjs '{"brain":"scripted","approve":false,"shop":"festive"}'
const spec = JSON.parse(process.argv[2] || "{}");
const { runRestock } = await import("../src/agent/index.mjs");
const { resetShop, loadShop, saveShop } = await import("../src/store/shop.mjs");

resetShop();
const shop = loadShop();
if (spec.shop === "steady") {
  // Flatten the last 14 days so this week's sales match last week's (no unusual demand).
  const dates = [...new Set(shop.sales.map((s) => s.date))].sort().slice(-14);
  const recent = shop.sales.filter((s) => dates.includes(s.date));
  for (const item of shop.items) {
    const rows = recent.filter((s) => s.itemId === item.id);
    const avg = rows.reduce((a, s) => a + s.qty, 0) / (rows.length || 1);
    rows.forEach((s) => { s.qty = avg; });
  }
}
if (spec.shop === "covered") for (const item of shop.items) item.incoming = item.packSize * 10;
saveShop(shop);

const events = [];
const result = await runRestock({ emit: (e) => events.push(e), approve: async () => spec.approve === true, brain: spec.brain });
const rec = events.find((e) => e.type === "recommendation")?.recommendation ?? null;

const out = {
  brain: events.find((e) => e.type === "start")?.brain,
  walletUsdcAtStart: events.find((e) => e.type === "start")?.walletUsdc,
  rec: rec && { supplierId: rec.supplierId, supplier: rec.supplier, totalUsd: rec.totalUsd, reason: rec.reason,
                lines: Object.fromEntries(rec.lines.map((l) => [l.itemId, l.packs])), comparison: rec.comparison },
  decision: result.decision,
  summary: result.summary,
  dataSpentUsd: result.dataSpentUsd,
  payments: result.payments.map(({ kind, why, url, priceUsd, paid, reason, link, payTo }) => ({ kind, why, url, priceUsd, paid, reason, link, payTo })),
  tools: events.filter((e) => e.type === "tool").map((e) => ({ name: e.name, args: e.args })),
  errors: events.filter((e) => e.type === "error" || e.type === "fatal").map((e) => e.message),
};
process.stdout.write(`\n@@RESULT@@${JSON.stringify(out)}\n`);
process.exit(0);
