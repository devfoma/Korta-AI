// Comparing supplier offers: pure functions, no AI. Used by the scripted brain to choose,
// by propose_order to catch a late delivery, and by the dashboard's comparison table.
const cents = (n) => Math.round(n * 100) / 100;

// needs: [{ itemId, packs, daysOfCover }]   quote: a quote bought this run
export function evaluateOffer(quote, needs) {
  const covered = [];
  const missing = [];
  for (const need of needs) {
    const line = quote.lines.find((l) => l.itemId === need.itemId);
    if (line && line.unitPriceUsd != null && line.available >= need.packs) covered.push({ ...need, unitPriceUsd: line.unitPriceUsd });
    else missing.push(need.itemId);
  }
  const runsOutIn = Math.min(...needs.map((n) => n.daysOfCover ?? Infinity));
  return {
    supplierId: quote.supplierId,
    supplier: quote.supplier,
    quoteId: quote.quoteId,
    deliveryDays: quote.deliveryDays,
    totalUsd: cents(covered.reduce((s, c) => s + c.packs * c.unitPriceUsd, 0)),
    complete: missing.length === 0,
    missing,
    // Arrives before the shelf is empty (strictly: arriving the day you run out is a lost sales day).
    onTime: quote.deliveryDays < runsOutIn,
    runsOutIn,
  };
}

// Best first: on time + complete, then cheapest. Then complete + fastest. Then most items covered.
export function rankOffers(quotes, needs) {
  const offers = quotes.map((q) => evaluateOffer(q, needs));
  const score = (o) => (o.onTime && o.complete ? 0 : o.complete ? 1 : 2);
  return offers.sort((a, b) =>
    score(a) - score(b) ||
    (score(a) === 0 ? a.totalUsd - b.totalUsd : a.deliveryDays - b.deliveryDays) ||
    a.missing.length - b.missing.length ||
    a.totalUsd - b.totalUsd);
}
