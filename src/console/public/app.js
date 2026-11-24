// Korta dashboard: vanilla JS, no build step. Everything from the server is rendered with
// textContent (never innerHTML), because supplier text is untrusted.
const $ = (id) => document.getElementById(id);
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const usdc = (n) => (n == null ? "—" : Number(n).toFixed(2));
const money = (n) => `$${Number(n) > 0 && Number(n) < 0.01 ? Number(n).toFixed(3) : Number(n).toFixed(2)}`;
const units = (n, unit) => `${n} ${unit === "kg" || n === 1 ? unit : `${unit}s`}`;
const receipt = (link) => h("a", { href: link, target: "_blank", rel: "noopener", class: "link" }, "receipt ↗");

let cfg = null;
let brain = "scripted";
let showAll = false;
let lastItems = [];
let source = null;
let countdown = null;

// ── Shop, wallet, ledger ───────────────────────────────────
async function loadShop() {
  const data = await fetch("/api/shop").then((r) => r.json());
  $("shopName").textContent = `${data.shop.name} · ${data.shop.area}`;
  $("walletUsdc").textContent = usdc(data.walletUsdc);
  $("spentToday").textContent = money(data.spentTodayUsd);
  lastItems = data.items;
  renderItems();
  renderLedger(data.ledger);
}

function renderItems() {
  const items = [...lastItems].sort((a, b) => (a.daysOfCover ?? 99) - (b.daysOfCover ?? 99));
  const atRisk = items.filter((i) => i.atRisk).length;
  $("riskCount").textContent = atRisk ? `${atRisk} need restocking` : "All covered";
  $("riskCount").className = atRisk ? "pill bad" : "pill";
  const shown = showAll ? items : items.slice(0, 5);
  $("items").replaceChildren(...shown.map((i) => {
    const days = i.daysOfCover ?? 0;
    const cls = i.atRisk ? "low" : days < 7 ? "mid" : "";
    return h("li", { class: `item ${cls}` },
      h("span", { class: "name", text: i.name }),
      h("span", { class: "days", text: `${days} days` }),
      h("span", { class: "bar" }, h("span", { style: `width:${Math.min(100, (days / 14) * 100)}%` })),
      h("span", { class: "sub" },
        `${units(i.stock, i.unit)} left · sells ~${i.dailyRate}/day`,
        i.incoming ? h("span", { class: "incoming", text: ` · +${i.incoming} incoming` }) : null));
  }));
  $("toggleItems").textContent = showAll ? "Show fewer" : `Show all ${items.length} items`;
}

function renderLedger(ledger) {
  if (!ledger.length) return $("ledger").replaceChildren(h("li", { class: "muted small", text: "No payments yet." }));
  $("ledger").replaceChildren(...ledger.map((e) => h("li", {},
    h("span", { text: e.type === "supplier payment" ? "Supplier order" : "Data purchase" }),
    h("span", { class: "amt", text: `${Math.abs(e.amountUsd) < 0.01 ? Math.abs(e.amountUsd).toFixed(3) : Math.abs(e.amountUsd).toFixed(2)} USDC` }),
    h("span", { class: "memo" }, e.memo, " · ", receipt(e.link)))));
}

// ── Timeline ───────────────────────────────────────────────
function addStep(kind, icon, text, detail) {
  const li = h("li", { class: kind }, h("span", { class: "icon", text: icon }), h("div", {}, h("span", { text }), detail ? h("span", { class: "detail" }, detail) : null));
  $("timeline").append(li);
  return li;
}
let lastStep = null;
let pendingRows = [];
const rowsByUrl = new Map();
const rowOf = (e) => rowsByUrl.get(e.url) ?? lastStep;
const setDetail = (li, ...content) => {
  if (!li) return;
  let d = li.querySelector(".detail");
  if (!d) { d = h("span", { class: "detail" }); li.lastChild.append(d); }
  d.replaceChildren(...content);
};

function onEvent(e) {
  switch (e.type) {
    case "start":
      addStep("", "▶", `Started with the ${e.brain === "ai" ? `AI brain (${e.model})` : "scripted brain"}`, `Wallet holds ${usdc(e.walletUsdc)} USDC`);
      break;
    case "notice": addStep("error", "!", e.text); break;
    case "thinking": break;
    case "thought": addStep("thought", "…", e.text); break;
    case "tool":
      lastStep = addStep("", "•", e.label);
      // Paid tools can run in parallel: the wallet's next "step" event claims this row.
      if (e.name === "buy_quote" || e.name === "buy_demand_signal") pendingRows.push(lastStep);
      break;
    case "stock": {
      const risk = e.report.items.filter((i) => i.atRisk);
      setDetail(lastStep, risk.length ? `${risk.map((i) => `${i.name}: ${i.daysOfCover} days left`).join(" · ")}. ${e.note}` : e.note);
      lastItems = e.report.items; renderItems();
      break;
    }
    case "step":
      rowsByUrl.set(e.url, e.kind === "data" ? (pendingRows.shift() ?? addStep("", "•", e.why)) : addStep("", "•", "Paying the supplier invoice via x402"));
      break;
    case "quote": setDetail(rowOf(e), `Costs ${money(e.priceUsd)} · checking your rules…`); break;
    case "paying": setDetail(rowOf(e), `Paying ${money(e.priceUsd)} via x402…`); break;
    case "paid": {
      const row = rowOf(e);
      row?.classList.add("paid");
      setDetail(row, e.kind === "order" ? `Paid ${usdc(e.priceUsd)} USDC into the supplier's wallet · ` : `Paid ${money(e.priceUsd)} · `, receipt(e.link));
      break;
    }
    case "refused":
      rowOf(e)?.classList.add("refused");
      setDetail(rowOf(e), `Refused by your rules (${e.rule}): ${e.reason}. Nothing was signed.`);
      break;
    case "offer":
      rowOf(e)?.querySelector(".detail")?.append(
        ` · offer: ${usdc(e.quote.totalUsd)} USDC, delivers in ${e.quote.deliveryDays} day${e.quote.deliveryDays === 1 ? "" : "s"}${e.quote.allInStock ? "" : ", missing items"}`);
      break;
    case "demand":
      rowOf(e)?.querySelector(".detail")?.append(` · outlook ×${e.multiplier}: ${e.reason}`);
      break;
    case "recommendation": showRecommendation(e.recommendation); break;
    case "decision":
      stopCountdown();
      $("recButtons").hidden = true;
      $("recStatus").textContent = e.approved ? "Approved. Paying the supplier via x402…" : `Not ordered: ${e.reason}.`;
      break;
    case "unpaid":
      addStep("refused", "✗", "The supplier invoice was NOT paid", e.reason);
      $("recStatus").textContent = `Not paid: ${e.reason}`;
      break;
    case "records":
      addStep("paid", "✓", `Records updated: delivery on ${e.order.deliveryDate}`, "Stock shows as incoming.");
      $("recStatus").replaceChildren(`Paid ${usdc(e.order.totalUsd)} USDC · delivery ${e.order.deliveryDate} · `, receipt(e.order.link));
      lastItems = e.items; renderItems();
      break;
    case "error": {
      const row = rowsByUrl.get(e.url);
      if (row) { row.classList.add("error"); setDetail(row, `${e.message}${e.hint ? `. ${e.hint}` : ""}`); }
      else addStep("error", "!", e.message, e.hint);
      break;
    }
    case "fatal": addStep("error", "!", `Stopped: ${e.message}`); finish(); break;
    case "done":
      $("resultCard").hidden = false;
      $("summary").textContent = e.summary;
      $("spendLine").textContent = `Spent ${money(e.dataSpentUsd)} on data this run · ${e.payments.filter((p) => p.paid).length} payments · wallet now ${usdc(e.walletUsdc)} USDC`;
      finish();
      break;
  }
}

// ── Recommendation + approval ─────────────────────────────
function showRecommendation(r) {
  $("recCard").hidden = false;
  $("recSupplier").textContent = r.supplier;
  $("recMeta").textContent = `${r.area} · delivers in ${r.deliveryDays} day${r.deliveryDays === 1 ? "" : "s"}`;
  $("recLines").replaceChildren(...r.lines.map((l) => h("li", {},
    h("span", { text: `${l.packs} × ${l.pack} · ${l.name}` }), h("span", { text: `${usdc(l.lineTotalUsd)}` }))));
  $("recTotal").textContent = `${usdc(r.totalUsd)} USDC`;
  $("recAfter").textContent = `Wallet after this order: ${usdc(r.walletAfterUsd)} USDC · data spent so far: ${money(r.dataSpentUsd)}`;
  $("recReason").textContent = r.reason || "—";
  $("recGap").hidden = !r.notCovered.length;
  $("recGap").textContent = r.notCovered.length ? `Not covered by this order: ${r.notCovered.join(", ")}` : "";
  $("recCompare").replaceChildren(...r.comparison.map((o) => h("tr", { class: o.supplierId === r.supplierId ? "chosen" : "" },
    h("td", { text: o.supplier }),
    h("td", { text: `${o.deliveryDays} day${o.deliveryDays === 1 ? "" : "s"}` }),
    h("td", { text: o.complete ? usdc(o.totalUsd) : "—" }),
    h("td", {}, !o.complete ? h("span", { class: "tag bad", text: `missing ${o.missing.join(", ")}` })
      : o.onTime ? h("span", { class: "tag ok", text: "in time" }) : h("span", { class: "tag bad", text: "too late" })))));
  $("recButtons").hidden = false;
  $("approve").textContent = `Approve & pay ${usdc(r.totalUsd)} USDC`;
  $("approve").disabled = $("decline").disabled = false;
  startCountdown(cfg.policy.approvalTimeoutSeconds);
  $("recCard").scrollIntoView({ behavior: "smooth", block: "start" });
}

function startCountdown(seconds) {
  stopCountdown();
  const end = Date.now() + seconds * 1000;
  const tick = () => {
    const left = Math.max(0, Math.round((end - Date.now()) / 1000));
    $("recStatus").textContent = `Waiting for you · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} (no answer = no order)`;
  };
  tick();
  countdown = setInterval(tick, 1000);
}
function stopCountdown() { if (countdown) clearInterval(countdown); countdown = null; }

async function answer(approved) {
  // On a public deployment only the owner can approve a payment. Declining never needs the PIN.
  let pin;
  if (approved && cfg.pinRequired) {
    pin = window.prompt("Owner PIN to approve this payment");
    if (pin === null) return;
  }
  $("approve").disabled = $("decline").disabled = true;
  const res = await fetch("/api/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved, pin }) });
  if (res.status === 403) {
    $("approve").disabled = $("decline").disabled = false;
    $("recStatus").textContent = "Wrong owner PIN. Nothing was paid; try again or decline.";
  }
}

// ── Run ────────────────────────────────────────────────────
function start() {
  $("run").disabled = true;
  $("run").textContent = "Korta is working…";
  $("timeline").replaceChildren();
  $("timelineCard").hidden = false;
  $("recCard").hidden = true;
  $("resultCard").hidden = true;
  lastStep = null;
  pendingRows = [];
  rowsByUrl.clear();
  source = new EventSource(`/api/run?brain=${brain}`);
  source.onmessage = (m) => onEvent(JSON.parse(m.data));
  source.onerror = () => { if (source) { addStep("error", "!", "Lost connection to Korta."); finish(); } };
}

function finish() {
  source?.close();
  source = null;
  stopCountdown();
  $("run").disabled = false;
  $("run").textContent = "Check my stock";
  loadShop();
}

function setBrain(b) {
  brain = b;
  document.querySelectorAll(".seg button").forEach((btn) => btn.setAttribute("aria-pressed", String(btn.dataset.brain === b)));
  $("brainNote").textContent = b === "ai"
    ? `AI brain: ${cfg.aiModel} decides; your rules still decide what gets paid.`
    : "Scripted brain: fixed decision rules, same tools and the same wallet rules.";
}

async function loadDemo() {
  const s = await fetch("/api/scenario").then((r) => r.json());
  if (!s.enabled) return;
  $("demoCard").hidden = false;
  $("scenario").replaceChildren(...Object.entries(s.scenarios).map(([k, label]) => h("option", { value: k, text: label })));
  $("scenario").value = s.scenario;
  const p = cfg.policy;
  $("policy").replaceChildren(
    h("li", { text: `Data (quotes, demand): auto-pay up to $${p.dataMaxPerRequestUsd} each, $${p.dataBudgetPerRunUsd} per run` }),
    h("li", { text: `Orders: always need your approval; max ${p.orderMaxUsd} USDC each` }),
    h("li", { text: `Cash reserve: never below ${p.cashReserveUsd} USDC` }),
    h("li", { text: `Daily limit: ${p.dailyBudgetUsd} USDC · pays only: ${p.allowedHosts.join(", ")}` }),
    h("li", { text: `No answer within ${Math.round(p.approvalTimeoutSeconds / 60)} min = declined` }));
}

async function init() {
  cfg = await fetch("/api/config").then((r) => r.json());
  if (cfg.walletLink) $("walletLink").href = cfg.walletLink;
  const aiBtn = document.querySelector('[data-brain="ai"]');
  aiBtn.disabled = !cfg.aiAvailable;
  if (!cfg.aiAvailable) aiBtn.title = "Add OPENAI_API_KEY and OPENAI_MODEL to .env";
  setBrain(cfg.defaultBrain === "ai" && cfg.aiAvailable ? "ai" : "scripted");
  document.querySelectorAll(".seg button").forEach((btn) => btn.addEventListener("click", () => setBrain(btn.dataset.brain)));
  $("run").addEventListener("click", start);
  $("approve").addEventListener("click", () => answer(true));
  $("decline").addEventListener("click", () => answer(false));
  $("toggleItems").addEventListener("click", () => { showAll = !showAll; renderItems(); });
  $("scenario").addEventListener("change", async (ev) => {
    await fetch("/api/scenario", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: ev.target.value }) });
  });
  $("reset").addEventListener("click", async () => {
    await fetch("/api/reset", { method: "POST" });
    $("timelineCard").hidden = $("recCard").hidden = $("resultCard").hidden = true;
    await loadShop();
    await loadDemo();
  });
  await Promise.all([loadShop(), loadDemo()]);
}

init();
