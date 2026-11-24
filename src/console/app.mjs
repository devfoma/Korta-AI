// The Korta console: the owner's dashboard. Runs Korta and streams every step live (SSE),
// waits for the owner's Approve / Decline, shows stock, orders and receipts.
// Keys stay in this process; the browser only receives events. Adapted from the EmpowerHer kit.
import express from "express";
import { fileURLToPath } from "node:url";
import { config, aiAvailable, explorer } from "../config.mjs";
import { runRestock } from "../agent/index.mjs";
import { walletAddress, walletUsdc, spentTodayUsd } from "../wallet/index.mjs";
import { loadShop, resetShop } from "../store/shop.mjs";
import { stockReport } from "../agent/stock.mjs";

const app = express();
app.use(express.json());
app.use(express.static(fileURLToPath(new URL("./public", import.meta.url))));

const supplierApi = (path, init) => fetch(`${config.suppliersBaseUrl}${path}`, init).then((r) => r.json());

// Public info only; never a secret. The owner sees their own rules here; the AI never does.
app.get("/api/config", (_req, res) => {
  const pub = walletAddress();
  res.json({
    network: config.network,
    wallet: pub,
    walletLink: pub ? explorer.account(pub) : null,
    faucetUrl: config.usdc.faucetUrl,
    policy: config.policy,
    defaultBrain: config.ai.brain,
    aiAvailable: aiAvailable(),
    aiModel: config.ai.model || null,
    demoControls: config.demoControls,
  });
});

app.get("/api/shop", async (_req, res) => {
  const shop = loadShop();
  let usdc = null;
  try { usdc = await walletUsdc(); } catch { /* Horizon hiccup: show "—" */ }
  res.json({
    shop: shop.shop,
    items: stockReport(shop).items,
    orders: shop.orders.slice(-5).reverse(),
    ledger: shop.ledger.slice(-12).reverse(),
    walletUsdc: usdc,
    spentTodayUsd: spentTodayUsd(),
  });
});

app.post("/api/reset", async (_req, res) => {
  if (running) return res.status(409).json({ error: "Korta is running." });
  resetShop();
  if (config.demoControls) await supplierApi("/demo/scenario", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "default" }) }).catch(() => {});
  res.json({ ok: true });
});

app.get("/api/scenario", async (_req, res) => {
  if (!config.demoControls) return res.json({ enabled: false });
  try { res.json({ enabled: true, ...(await supplierApi("/demo/scenario")) }); }
  catch { res.json({ enabled: false }); }
});

app.post("/api/scenario", async (req, res) => {
  if (!config.demoControls) return res.status(403).json({ error: "Demo controls are off." });
  if (running) return res.status(409).json({ error: "Korta is running." });
  const out = await supplierApi("/demo/scenario", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: req.body?.name }) });
  res.json(out);
});

// One run at a time, so a double tap can't double-spend. Only one approval can be waiting.
let running = false;
let pendingApproval = null;

app.post("/api/approve", (req, res) => {
  if (!pendingApproval) return res.status(409).json({ error: "Nothing is waiting for approval." });
  const resolve = pendingApproval;
  pendingApproval = null;
  resolve(req.body?.approved === true);
  res.json({ ok: true });
});

app.get("/api/run", async (req, res) => {
  if (running) return res.status(409).json({ error: "Korta is already running." });
  running = true;
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000); // keeps proxies from closing the stream

  // Waits for Approve / Decline. No answer in time, or the page closed: declined.
  const approve = () => new Promise((resolve) => {
    pendingApproval = resolve;
    const decline = (why) => { if (pendingApproval === resolve) { pendingApproval = null; resolve(why); } };
    const timer = setTimeout(() => decline("timeout"), config.policy.approvalTimeoutSeconds * 1000);
    req.on("close", () => { clearTimeout(timer); decline(false); });
  });

  try {
    const brain = ["ai", "scripted"].includes(req.query.brain) ? req.query.brain : config.ai.brain;
    const task = String(req.query.task || "").trim().slice(0, 200) || undefined;
    await runRestock({ task, emit: send, approve, brain });
  } catch (e) {
    send({ type: "fatal", message: e.message });
  } finally {
    clearInterval(heartbeat);
    running = false;
    res.end();
  }
});

app.listen(config.consolePort, () => {
  console.log(`\nKorta console on http://localhost:${config.consolePort}`);
  console.log("(the Supplier Network must be running too: npm run suppliers, or use npm start for both)\n");
});
