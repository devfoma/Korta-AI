// The Supplier Network: the x402 SELLERS Korta buys from.
//   - 3 suppliers sell live quotes ($0.002) and get paid for orders (the real order total),
//     each into its OWN Stellar wallet (dynamic payTo).
//   - 1 market-data seller sells a local demand signal ($0.005).
// This server never touches the blockchain: the facilitator verifies and settles each payment.
import express from "express";
import { StrKey } from "@stellar/stellar-sdk";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { config } from "../config.mjs";
import { suppliersFor, SCENARIOS, DEMAND } from "./catalog.mjs";

const { network, usdc, facilitator: fac, payees } = config;
const QUOTE_PRICE_USD = 0.002;
const DEMAND_PRICE_USD = 0.005;
const QUOTE_TTL_MS = 10 * 60_000;

// ── State (in memory: a demo network, restarted = fresh) ──
let scenario = "default";
const suppliers = () => suppliersFor(scenario);
const quotes = new Map();   // quoteId → quote
const orders = new Map();   // orderId → order
const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const cents = (n) => Math.round(n * 100) / 100;
const price = (dollars) => ({ amount: String(Math.round(dollars * 10 ** usdc.decimals)), asset: usdc.contractId });

// /suppliers/:id/...  and  /suppliers/:id/orders/:orderId/pay
const parts = (path) => path.split("?")[0].split("/").filter(Boolean);
const supplierIdOf = (path) => parts(path)[1];
const orderIdOf = (path) => parts(path)[3];

// "rice:4,oil:2" → [{ itemId: "rice", packs: 4 }, …]
function parseItems(raw) {
  const lines = String(raw || "").split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
    const [itemId, packs] = p.split(":");
    return { itemId: itemId?.trim().toLowerCase(), packs: Number(packs) };
  });
  const ok = lines.length > 0 && lines.length <= 12 && lines.every((l) => /^[a-z0-9-]+$/.test(l.itemId) && Number.isInteger(l.packs) && l.packs > 0 && l.packs <= 500);
  return ok ? lines : null;
}

// ── x402: which routes cost what, paid to whom ─────────────
const routes = {
  "GET /suppliers/:id/quote": {
    accepts: { scheme: "exact", price: price(QUOTE_PRICE_USD), network, payTo: (ctx) => payees[supplierIdOf(ctx.path)] },
    description: "Live prices, stock and delivery time from a supplier",
    mimeType: "application/json",
  },
  "POST /suppliers/:id/orders/:orderId/pay": {
    accepts: {
      scheme: "exact", network,
      price: (ctx) => price(orders.get(orderIdOf(ctx.path))?.totalUsd ?? 0),
      payTo: (ctx) => payees[supplierIdOf(ctx.path)],
    },
    description: "Pay a supplier invoice",
    mimeType: "application/json",
  },
  "GET /market/demand": {
    accepts: { scheme: "exact", price: price(DEMAND_PRICE_USD), network, payTo: payees.market },
    description: "Local demand outlook for a product category",
    mimeType: "application/json",
  },
};

const facilitatorClient = new HTTPFacilitatorClient({
  url: fac.url,
  ...(fac.apiKey && {
    createAuthHeaders: async () => {
      const h = { Authorization: `Bearer ${fac.apiKey}` };
      return { verify: h, settle: h, supported: h };
    },
  }),
});

const app = express();
app.use(express.json());

// Plain-English request log: 402 = "asked to pay", 200 = "paid and served".
app.use((req, res, next) => {
  res.on("finish", () => {
    if (!/^\/(suppliers|market)\//.test(req.path)) return;
    const label = { 402: "402 → payment required", 200: "200 → served" }[res.statusCode] ?? res.statusCode;
    console.log(`${new Date().toLocaleTimeString()}  ${req.method} ${req.originalUrl}  ${label}`);
  });
  next();
});

// Validate BEFORE the payment step, so nobody is charged for a request that can't be served.
app.use((req, res, next) => {
  const p = parts(req.path);
  if (p[0] !== "suppliers") return next();
  const supplier = suppliers()[p[1]];
  if (!supplier || !payees[p[1]]) return res.status(404).json({ error: "Unknown supplier." });
  if (req.method === "GET" && p[2] === "quote" && p.length === 3 && !parseItems(req.query.items))
    return res.status(400).json({ error: 'Bad items. Use ?items=rice:4,oil:2 (item id : number of packs).' });
  if (req.method === "POST" && p[2] === "orders" && p[4] === "pay") {
    const order = orders.get(p[3]);
    if (!order || order.supplierId !== p[1]) return res.status(404).json({ error: "Unknown order." });
    if (order.status === "paid") return res.status(409).json({ error: "This order is already paid.", order });
  }
  next();
});

// Fail closed: without valid payee wallets, paid routes return 503, never their data for free.
const payeesValid = Object.values(payees).every((g) => StrKey.isValidEd25519PublicKey(g));
if (payeesValid) {
  const resourceServer = new x402ResourceServer(facilitatorClient)
    .register(network, new ExactStellarScheme())
    // Mark an order paid only once the payment has actually settled on Stellar.
    .onAfterSettle(async ({ paymentPayload, result }) => {
      const url = paymentPayload?.resource?.url;
      const orderId = url ? orderIdOf(new URL(url, "http://x").pathname) : null;
      const order = orderId && orders.get(orderId);
      if (order && result?.success) Object.assign(order, { status: "paid", tx: result.transaction, paidAt: new Date().toISOString() });
    })
    .onVerifyFailure(async ({ error }) => console.warn(`  ✗ verify failed: ${error.message}`))
    .onSettleFailure(async ({ error }) => console.warn(`  ✗ settle failed: ${error.message}  (check the explorer: it may still land)`));
  app.use(paymentMiddleware(routes, resourceServer));
} else {
  console.warn("⚠ Payee wallets missing or invalid: paid routes return 503. Run: npm run setup");
  app.use(["/suppliers/:id/quote", "/suppliers/:id/orders/:orderId/pay", "/market/demand"], (_req, res) =>
    res.status(503).json({ error: "Payments not configured on this server." }));
}

// ── Free routes ────────────────────────────────────────────
app.get("/directory", (_req, res) => {
  res.json({
    network,
    asset: usdc.code,
    quotePriceUsd: QUOTE_PRICE_USD,
    suppliers: Object.values(suppliers()).map(({ id, name, area, categories }) => ({ id, name, area, categories, wallet: payees[id] })),
    demandSignal: { path: "/market/demand?category=staples", priceUsd: DEMAND_PRICE_USD },
  });
});

// Turn a paid quote into an order. Free: the order is only paid on the next step, after the owner approves.
app.post("/suppliers/:id/orders", (req, res) => {
  const supplier = suppliers()[req.params.id];
  const quote = quotes.get(String(req.body?.quoteId || ""));
  if (!quote || quote.supplierId !== supplier.id) return res.status(404).json({ error: "Unknown quote." });
  if (Date.now() > quote.expiresAt) return res.status(410).json({ error: "Quote expired. Buy a new quote." });

  const wanted = Array.isArray(req.body?.lines) ? req.body.lines : [];
  const lines = [];
  for (const w of wanted) {
    const q = quote.lines.find((l) => l.itemId === w.itemId);
    const packs = Number(w.packs);
    if (!q || !q.inStock || !Number.isInteger(packs) || packs < 1 || packs > q.available)
      return res.status(400).json({ error: `Can't order ${w.packs} × ${w.itemId} on this quote.` });
    lines.push({ itemId: q.itemId, packs, unitPriceUsd: q.unitPriceUsd });
  }
  if (!lines.length) return res.status(400).json({ error: "No order lines." });

  // In the "price-jump" scenario the supplier quietly re-prices after quoting.
  const jump = SCENARIOS[scenario]?.priceJump;
  const factor = jump?.supplierId === supplier.id ? jump.factor : 1;
  const totalUsd = cents(lines.reduce((sum, l) => sum + l.packs * l.unitPriceUsd, 0) * factor);

  const orderId = newId("ord");
  const deliveryDate = new Date(Date.now() + supplier.deliveryDays * 86_400_000).toISOString().slice(0, 10);
  const order = { orderId, supplierId: supplier.id, supplier: supplier.name, quoteId: quote.quoteId, lines, totalUsd,
                  deliveryDate, status: "awaiting payment", payPath: `/suppliers/${supplier.id}/orders/${orderId}/pay` };
  orders.set(orderId, order);
  res.status(201).json(order);
});

app.get("/suppliers/:id/orders/:orderId", (req, res) => {
  const order = orders.get(req.params.orderId);
  if (!order || order.supplierId !== req.params.id) return res.status(404).json({ error: "Unknown order." });
  res.json(order);
});

// ── Paid routes (served only after x402 payment) ───────────
app.get("/suppliers/:id/quote", (req, res) => {
  const supplier = suppliers()[req.params.id];
  const lines = parseItems(req.query.items).map(({ itemId, packs }) => {
    const unitPriceUsd = supplier.prices[itemId];
    const available = supplier.stock[itemId] ?? 0;
    const inStock = unitPriceUsd !== undefined && available >= packs;
    return { itemId, packs, unitPriceUsd: unitPriceUsd ?? null, available, inStock,
             lineTotalUsd: inStock ? cents(packs * unitPriceUsd) : 0,
             ...(unitPriceUsd === undefined ? { reason: "not carried" } : !inStock ? { reason: `only ${available} in stock` } : {}) };
  });
  const quote = {
    quoteId: newId("q"), supplierId: supplier.id, supplier: supplier.name, area: supplier.area,
    deliveryDays: supplier.deliveryDays, expiresAt: Date.now() + QUOTE_TTL_MS,
    lines, totalUsd: cents(lines.reduce((s, l) => s + l.lineTotalUsd, 0)),
    allInStock: lines.every((l) => l.inStock), note: supplier.note, demo: true,
  };
  quotes.set(quote.quoteId, quote);
  res.json({ ...quote, validUntil: new Date(quote.expiresAt).toISOString() });
});

app.post("/suppliers/:id/orders/:orderId/pay", (req, res) => {
  const order = orders.get(req.params.orderId);
  // Settlement happens right after this handler; onAfterSettle marks the order paid.
  res.json({ orderId: order.orderId, supplier: order.supplier, totalUsd: order.totalUsd, deliveryDate: order.deliveryDate,
             message: `Payment received. Delivery on ${order.deliveryDate}.` });
});

app.get("/market/demand", (req, res) => {
  const category = String(req.query.category || "staples").slice(0, 40);
  const d = SCENARIOS[scenario]?.demandMultiplier === 1.0 ? DEMAND.stable : DEMAND.festive;
  res.json({ category, area: String(req.query.area || "Lagos").slice(0, 40), ...d, demo: true });
});

// ── Demo controls (evals + live guardrail demo) ────────────
if (config.demoControls) {
  app.get("/demo/scenario", (_req, res) => res.json({ scenario, scenarios: Object.fromEntries(Object.entries(SCENARIOS).map(([k, v]) => [k, v.label])) }));
  app.post("/demo/scenario", (req, res) => {
    const name = String(req.body?.name || "");
    if (!SCENARIOS[name]) return res.status(400).json({ error: `Unknown scenario. Try: ${Object.keys(SCENARIOS).join(", ")}` });
    scenario = name;
    console.log(`  ⚙ scenario → ${name}: ${SCENARIOS[name].label}`);
    res.json({ scenario });
  });
}

app.listen(config.port, () => {
  console.log(`\nSupplier Network on http://localhost:${config.port}  ·  ${network}  ·  facilitator: ${fac.name}`);
  console.log(`Suppliers: ${Object.values(suppliers()).map((s) => s.name).join(" · ")}  ·  scenario: ${scenario}\n`);
});
