// Generates data/shop.seed.json: one demo shop with 12 items and 30 days of sales.
// Deterministic (no randomness), so every run of the demo and the evals starts from the same shop.
//
// The story: rice and vegetable oil are fast movers, down to ~3 days of cover, and selling
// ~25% more this week than last (festive season). Everything else has 10+ days of cover.
import fs from "node:fs";

const DAYS = 30;
// Weekday shape (Mon..Sun), averages to 1.0: Saturday is market day, Sunday is quiet.
const WEEK = [0.95, 0.95, 1.0, 1.0, 1.1, 1.3, 0.7];

// rate = average daily sales over the last 14 days (in sale units).
// trend = last 7 days vs the 7 before (+0.25 = 25% up).
const ITEMS = [
  { id: "rice",      name: "Rice",                  unit: "kg",     pack: "50kg bag",           packSize: 50, stock: 60,  rate: 20, trend: 0.25, category: "staples" },
  { id: "oil",       name: "Vegetable oil 1L",      unit: "bottle", pack: "carton (12 × 1L)",   packSize: 12, stock: 6,   rate: 2,  trend: 0.25, category: "staples" },
  { id: "sugar",     name: "Sugar 1kg",             unit: "pack",   pack: "bag of 20",          packSize: 20, stock: 70,  rate: 5,  trend: 0,    category: "staples" },
  { id: "noodles",   name: "Instant noodles",       unit: "pack",   pack: "carton of 40",       packSize: 40, stock: 120, rate: 12, trend: 0,    category: "staples" },
  { id: "tomato",    name: "Tomato paste tin",      unit: "tin",    pack: "carton of 50",       packSize: 50, stock: 90,  rate: 6,  trend: 0,    category: "staples" },
  { id: "milk",      name: "Milk powder 400g",      unit: "tin",    pack: "carton of 24",       packSize: 24, stock: 40,  rate: 3,  trend: 0,    category: "staples" },
  { id: "flour",     name: "Flour",                 unit: "kg",     pack: "50kg bag",           packSize: 50, stock: 100, rate: 6,  trend: 0,    category: "staples" },
  { id: "beans",     name: "Beans",                 unit: "kg",     pack: "50kg bag",           packSize: 50, stock: 80,  rate: 7,  trend: 0,    category: "staples" },
  { id: "garri",     name: "Garri",                 unit: "kg",     pack: "50kg bag",           packSize: 50, stock: 90,  rate: 8,  trend: 0,    category: "staples" },
  { id: "semovita",  name: "Semovita 1kg",          unit: "pack",   pack: "bale of 10",         packSize: 10, stock: 45,  rate: 3,  trend: 0,    category: "staples" },
  { id: "detergent", name: "Detergent 500g",        unit: "pack",   pack: "carton of 24",       packSize: 24, stock: 50,  rate: 4,  trend: 0,    category: "household" },
  { id: "water",     name: "Bottled water 75cl",    unit: "bottle", pack: "pack of 12",         packSize: 12, stock: 100, rate: 10, trend: 0,    category: "beverages" },
];

const today = new Date();
today.setUTCHours(0, 0, 0, 0);
const dateOf = (daysAgo) => new Date(today.getTime() - daysAgo * 86_400_000);
const iso = (d) => d.toISOString().slice(0, 10);

// Spread `total` over the given days following the weekday shape, as whole numbers that sum exactly.
function spread(total, days) {
  const weights = days.map((d) => WEEK[(d.getUTCDay() + 6) % 7]);
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest > 0; k++, rest--) out[order[k % order.length][1]]++;
  return out;
}

const sales = [];
for (const item of ITEMS) {
  // Last 14 days average exactly `rate`; split into the two weeks so last week is `trend` above the one before.
  const fortnight = item.rate * 14;
  const prevWeek = Math.round(fortnight / (2 + item.trend));
  const lastWeek = fortnight - prevWeek;
  const older = Math.round(item.rate * 16 * (item.trend ? 0.9 : 1)); // days 15–30 ago: a bit quieter before the festive run-up

  const block = (fromAgo, toAgo) => Array.from({ length: fromAgo - toAgo + 1 }, (_, i) => dateOf(fromAgo - i));
  const periods = [[block(30, 15), older], [block(14, 8), prevWeek], [block(7, 1), lastWeek]];
  for (const [days, total] of periods) {
    spread(total, days).forEach((qty, i) => sales.push({ date: iso(days[i]), itemId: item.id, qty }));
  }
}

const shop = {
  shop: { name: "Mama Ada Provisions", area: "Surulere, Lagos", currency: "USDC (testnet, demo-scale prices)" },
  asOf: iso(today),
  // Restock rule: flag an item when its days of cover drop below typical lead time + safety days;
  // order enough to reach the target days of cover.
  restockRule: { typicalLeadDays: 2, safetyDays: 2, targetCoverDays: 10 },
  items: ITEMS.map(({ rate, trend, ...item }) => ({ ...item, incoming: 0 })),
  sales,
  ledger: [],
  orders: [],
};

fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/shop.seed.json", JSON.stringify(shop, null, 1) + "\n");
console.log(`Wrote data/shop.seed.json: ${ITEMS.length} items, ${sales.length} sales rows, as of ${shop.asOf}`);
