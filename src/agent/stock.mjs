// Stock maths: pure functions, no AI, no network. Unit-tested in test/stock.test.mjs.
//
//   dailyRate   = average daily sales over the last 14 days
//   daysOfCover = stock / dailyRate
//   at risk     = daysOfCover < typicalLeadDays + safetyDays
//   packs       = enough to reach targetCoverDays (× demand multiplier), rounded up to whole packs

const round1 = (n) => Math.round(n * 10) / 10;

// Average daily sales per item over the `days` most recent days in the data.
export function dailyRates(sales, days = 14) {
  const dates = [...new Set(sales.map((s) => s.date))].sort();
  const recent = new Set(dates.slice(-days));
  const lastWeek = new Set(dates.slice(-7));
  const prevWeek = new Set(dates.slice(-14, -7));
  const acc = {};
  for (const s of sales) {
    const a = (acc[s.itemId] ??= { recent: 0, last: 0, prev: 0 });
    if (recent.has(s.date)) a.recent += s.qty;
    if (lastWeek.has(s.date)) a.last += s.qty;
    if (prevWeek.has(s.date)) a.prev += s.qty;
  }
  const out = {};
  for (const [id, a] of Object.entries(acc)) {
    out[id] = {
      dailyRate: a.recent / Math.max(recent.size, 1),
      trendPct: a.prev ? Math.round(((a.last - a.prev) / a.prev) * 100) : 0,
    };
  }
  return out;
}

export function packsNeeded({ dailyRate, stock, incoming = 0, packSize }, targetCoverDays, multiplier = 1) {
  const need = dailyRate * multiplier * targetCoverDays - stock - incoming;
  return need > 0 ? Math.ceil(need / packSize) : 0;
}

// The full stock picture. `multipliers` maps category → demand multiplier (from a bought demand signal).
export function stockReport(shop, multipliers = {}) {
  const { typicalLeadDays, safetyDays, targetCoverDays } = shop.restockRule;
  const rates = dailyRates(shop.sales);
  const items = shop.items.map((item) => {
    const { dailyRate = 0, trendPct = 0 } = rates[item.id] ?? {};
    const daysOfCover = dailyRate ? (item.stock + (item.incoming || 0)) / dailyRate : Infinity;
    const atRisk = daysOfCover < typicalLeadDays + safetyDays;
    const multiplier = multipliers[item.category] ?? 1;
    return {
      id: item.id,
      name: item.name,
      category: item.category,
      stock: item.stock,
      incoming: item.incoming || 0,
      unit: item.unit,
      pack: item.pack,
      packSize: item.packSize,
      dailyRate: round1(dailyRate),
      daysOfCover: Number.isFinite(daysOfCover) ? round1(daysOfCover) : null,
      trendPct,
      atRisk,
      demandMultiplier: multiplier,
      suggestedPacks: atRisk ? Math.max(1, packsNeeded({ ...item, dailyRate }, targetCoverDays, multiplier)) : 0,
    };
  });
  return { asOf: shop.asOf, rule: shop.restockRule, items };
}

// What the agent sees: only the items that need attention, plus a plain-English trend note.
export function stockSummaryForAgent(report) {
  const atRisk = report.items.filter((i) => i.atRisk);
  const unusual = atRisk.filter((i) => Math.abs(i.trendPct) >= 15);
  return {
    asOf: report.asOf,
    restockRule: `Restock when days of cover < ${report.rule.typicalLeadDays + report.rule.safetyDays}; order up to ${report.rule.targetCoverDays} days of cover.`,
    itemsChecked: report.items.length,
    atRisk: atRisk.map((i) => ({
      itemId: i.id,
      name: i.name,
      category: i.category,
      daysOfCover: i.daysOfCover,
      salesTrendThisWeek: `${i.trendPct >= 0 ? "+" : ""}${i.trendPct}%`,
      suggestedPacks: i.suggestedPacks,
      pack: i.pack,
      demandMultiplierApplied: i.demandMultiplier,
    })),
    note: atRisk.length === 0
      ? "Nothing needs restocking."
      : unusual.length
        ? `Sales are unusual this week for: ${unusual.map((i) => `${i.name} (${i.trendPct >= 0 ? "+" : ""}${i.trendPct}%)`).join(", ")}.`
        : "Sales are steady; no unusual demand this week.",
  };
}
