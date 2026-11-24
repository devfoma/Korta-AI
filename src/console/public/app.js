// Korta owner app: vanilla JS, no build step. Four tabs (Overview · Quotes · Approve · Rules) driven by
// the live event stream from /api/run. Server text is rendered with textContent, never innerHTML,
// because supplier text is untrusted.
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
const icon = (name, cls = "") => h("i", { "data-lucide": name, class: cls });
let iconsQueued = false;
function icons() {
  if (iconsQueued) return;
  iconsQueued = true;
  requestAnimationFrame(() => { iconsQueued = false; window.lucide?.createIcons(); });
}
const usdc = (n) => (n == null ? "—" : Number(n).toFixed(2));
const money = (n) => `$${Number(n) > 0 && Number(n) < 0.01 ? Number(n).toFixed(3) : Number(n).toFixed(2)}`;
const units = (n, unit) => `${n} ${unit === "kg" || n === 1 ? unit : `${unit}s`}`;
const days = (n) => `${n} day${n === 1 ? "" : "s"}`;
const shortTx = (tx) => (tx ? `${tx.slice(0, 4)}…${tx.slice(-4)}` : "");
const receiptLink = (link, label = "receipt") => h("a", { href: link, target: "_blank", rel: "noopener", class: "link" }, label, icon("external-link", "i-sm"));
function receiptPill(el, link, tx, label = "stellar.expert/tx/") {
  el.hidden = !link;
  if (!link) return;
  el.href = link;
  el.replaceChildren(h("span", { text: `${label}${shortTx(tx)}` }), icon("external-link"));
}

let cfg = null;
let brain = "scripted";
let showAll = false;
let lastItems = [];
let source = null;
let countdown = null;
let rec = null;
let approvedAt = 0;
let runStartedAt = 0;
const offers = new Map();     // url → { quote, link, tx }
const paidLinks = new Map();  // url → { link, tx }
let demand = null;

// ── Tabs ───────────────────────────────────────────────────
const TABS = ["overview", "quotes", "approve", "rules"];
function showTab() {
  const tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "overview";
  for (const t of TABS) {
    $(`tab-${t}`).hidden = t !== tab;
    document.querySelector(`[data-nav="${t}"]`).toggleAttribute("aria-current", t === tab);
    if (t === tab) document.querySelector(`[data-nav="${t}"]`).setAttribute("aria-current", "page");
  }
  window.scrollTo({ top: 0 });
}
const goTo = (tab) => { if (location.hash !== `#${tab}`) location.hash = tab; else showTab(); };

// ── Shop, wallet, ledger ───────────────────────────────────
async function loadShop() {
  const data = await fetch("/api/shop").then((r) => r.json());
  $("shopName").textContent = data.shop.name;
  $("shopArea").textContent = `${data.shop.area} · Korta keeps your fast movers in stock.`;
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
  $("riskCount").className = `chip ${atRisk ? "chip-warning" : "chip-success"}`;
  const shown = showAll ? items : items.slice(0, 5);
  $("items").replaceChildren(...shown.map((i) => {
    const d = i.daysOfCover ?? 0;
    return h("li", { class: `item ${i.atRisk ? "low" : d < 7 ? "mid" : ""}` },
      h("span", { class: "name", text: i.name }),
      h("span", { class: "days", text: `${d} days` }),
      h("span", { class: "bar" }, h("span", { style: `width:${Math.min(100, (d / 14) * 100)}%` })),
      h("span", { class: "sub" }, `${units(i.stock, i.unit)} left · sells ~${i.dailyRate}/day`,
        i.incoming ? h("span", { class: "incoming", text: ` · +${i.incoming} incoming` }) : null));
  }));
  $("toggleItems").textContent = showAll ? "Show fewer" : `Show all ${items.length} items`;
}

function renderLedger(ledger) {
  if (!ledger.length) return $("ledger").replaceChildren(h("li", { class: "t-body-sm muted", text: "No payments yet." }));
  $("ledger").replaceChildren(...ledger.map((e) => h("li", {},
    h("span", { text: e.type === "supplier payment" ? "Supplier order" : "Data purchase" }),
    h("span", { class: "amt", text: `${Math.abs(e.amountUsd) < 0.01 ? Math.abs(e.amountUsd).toFixed(3) : Math.abs(e.amountUsd).toFixed(2)} USDC` }),
    h("span", { class: "memo" }, h("span", { text: e.memo }), receiptLink(e.link)))));
  icons();
}

// ── Timeline (Overview) ────────────────────────────────────
let lastStep = null;
let pendingRows = [];
const rowsByUrl = new Map();
const rowOf = (e) => rowsByUrl.get(e.url) ?? lastStep;
function addStep(kind, iconName, text, detail) {
  const li = h("li", { class: kind }, h("span", { class: "dotico" }, icon(iconName)),
    h("div", {}, h("span", { text }), detail ? h("span", { class: "detail" }, detail) : null));
  $("timeline").append(li);
  icons();
  return li;
}
function setDetail(li, ...content) {
  if (!li) return;
  let d = li.querySelector(".detail");
  if (!d) { d = h("span", { class: "detail" }); li.lastChild.append(d); }
  d.replaceChildren(...content);
  icons();
}
function mark(li, kind, iconName) {
  if (!li) return;
  li.className = kind;
  li.querySelector(".dotico").replaceChildren(icon(iconName));
  icons();
}

// ── Quotes tab ─────────────────────────────────────────────
function renderQuotes() {
  $("quotesEmpty").hidden = offers.size > 0 || Boolean(demand);
  $("demandCard").hidden = !demand;
  if (demand) {
    $("demandChip").textContent = `×${demand.multiplier} demand`;
    $("demandText").textContent = demand.reason;
    receiptPill($("demandReceipt"), demand.link, demand.tx);
  }
  const ranked = rec?.comparison ?? [];
  const cards = [...offers.values()].map(({ quote: q }) => {
    const r = ranked.find((o) => o.quoteId === q.quoteId);
    const chosen = rec?.quoteId === q.quoteId;
    const tags = [
      chosen ? h("span", { class: "chip chip-primary", text: "Korta’s pick" }) : null,
      q.allInStock ? h("span", { class: "chip chip-success", text: "All in stock" })
                   : h("span", { class: "chip chip-warning", text: `Missing ${q.lines.filter((l) => !l.inStock).map((l) => l.itemId).join(", ")}` }),
      r ? (r.onTime ? h("span", { class: "chip chip-success", text: "Arrives in time" }) : h("span", { class: "chip chip-warning", text: "Too late" })) : null,
    ];
    return h("article", { class: `card offer${chosen ? " best" : ""}` },
      h("div", { class: "row-between" }, h("div", {}, h("p", { class: "t-title", text: q.supplier }), h("p", { class: "t-body-sm muted", text: q.area })),
        h("div", { class: "center" }, h("p", { class: "price", text: usdc(q.totalUsd) }), h("p", { class: "t-label-sm muted", text: "USDC" }))),
      h("p", { class: "t-body-sm" }, `Delivers in ${days(q.deliveryDays)}`),
      h("div", { class: "tags" }, tags),
      h("ul", { class: "offer-lines" }, q.lines.map((l) => h("li", { text: `${l.itemId}: ${l.packs} × ${l.unitPriceUsd == null ? "not carried" : `${usdc(l.unitPriceUsd)} USDC`}${l.inStock ? "" : ` · ${l.reason || "out of stock"}`}` }))));
  });
  $("offers").replaceChildren(...cards);
  [...offers.values()].forEach(({ link, tx }, i) => {
    if (!link) return;
    const pill = h("a", { class: "receipt-pill", target: "_blank", rel: "noopener" });
    receiptPill(pill, link, tx, "quote paid · ");
    cards[i].append(pill);
  });
  icons();
}

// ── Approve tab ────────────────────────────────────────────
function renderRecommendation(r) {
  rec = r;
  const chosen = r.comparison.find((o) => o.quoteId === r.quoteId);
  $("approveEmpty").hidden = true;
  $("recCard").hidden = false;
  $("approveDot").hidden = false;
  $("orderStatus").className = "chip chip-primary";
  $("orderStatus").textContent = "Waiting for you";
  $("recTitle").textContent = `Buy from ${r.supplier} — ${usdc(r.totalUsd)} USDC.`;
  $("recLines").replaceChildren(...r.lines.map((l) => h("li", {}, h("span", { text: `${l.packs} × ${l.pack} · ${l.name}` }), h("span", { text: usdc(l.lineTotalUsd) }))));
  $("recReason").textContent = r.reason || "";
  $("recGap").hidden = !r.notCovered.length;
  $("recGap").textContent = r.notCovered.length ? `Not covered by this order: ${r.notCovered.join(", ")}` : "";
  const p = cfg.policy;
  const checks = [
    [true, `${r.supplier} is a known supplier on your allow-list`],
    [true, `${usdc(r.totalUsd)} USDC is within your ${usdc(p.orderMaxUsd)} USDC order cap`],
    [true, `${usdc(r.walletAfterUsd)} USDC left after payment (above your ${usdc(p.cashReserveUsd)} reserve)`],
    chosen ? [chosen.onTime, chosen.onTime ? `Arrives in ${days(r.deliveryDays)}, before stock runs out in ${chosen.runsOutIn}` : `Arrives in ${days(r.deliveryDays)}, after stock runs out (no faster complete offer)`] : null,
    [true, `Korta spent ${money(r.dataSpentUsd)} on quotes and data to decide`],
  ].filter(Boolean);
  $("recChecks").replaceChildren(...checks.map(([ok, text]) => h("li", { class: ok ? "" : "fail" }, icon(ok ? "shield-check" : "shield-alert"), h("span", { text }))));
  $("recCompare").replaceChildren(...r.comparison.map((o) => h("div", { class: `row${o.quoteId === r.quoteId ? " chosen" : ""}` },
    h("span", { text: o.supplier }), h("span", { class: "muted", text: days(o.deliveryDays) }),
    h("span", { text: o.complete ? `${usdc(o.totalUsd)} · ${o.onTime ? "in time" : "too late"}` : `missing ${o.missing.join(", ")}` }))));
  $("settlement").hidden = true;
  $("orderActions").hidden = false;
  $("approve").disabled = $("decline").disabled = false;
  $("approve").querySelector("span").textContent = `Approve ${usdc(r.totalUsd)} USDC`;
  startCountdown(cfg.policy.approvalTimeoutSeconds);
  renderQuotes();
  icons();
  goTo("approve");
}

function settle({ ok, title, desc, link, tx }) {
  stopCountdown();
  $("orderActions").hidden = true;
  $("approveDot").hidden = true;
  $("settlement").hidden = false;
  $("settlement").className = `settlement${ok ? "" : " bad"}`;
  $("settlementTitle").textContent = title;
  $("settlementDesc").textContent = desc;
  receiptPill($("settlementReceipt"), link, tx);
  icons();
}

function startCountdown(seconds) {
  stopCountdown();
  const end = Date.now() + seconds * 1000;
  const tick = () => {
    const left = Math.max(0, Math.round((end - Date.now()) / 1000));
    $("orderMeta").textContent = `Quote locked · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} left`;
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
  if (approved) approvedAt = Date.now();
  const res = await fetch("/api/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved, pin }) });
  if (res.status === 403) {
    $("approve").disabled = $("decline").disabled = false;
    $("orderStatus").className = "chip chip-warning";
    $("orderStatus").textContent = "Wrong PIN";
  }
}

// ── Live events ────────────────────────────────────────────
function onEvent(e) {
  switch (e.type) {
    case "start":
      addStep("", "play", `Started with the ${e.brain === "ai" ? `AI brain (${e.model})` : "scripted brain"}`, `Wallet holds ${usdc(e.walletUsdc)} USDC`);
      break;
    case "notice": addStep("error", "info", e.text); break;
    case "thinking": break;
    case "thought": addStep("thought", "sparkles", e.text); break;
    case "tool":
      lastStep = addStep("", "circle", e.label);
      if (e.name === "buy_quote" || e.name === "buy_demand_signal") pendingRows.push(lastStep);
      break;
    case "stock": {
      const risk = e.report.items.filter((i) => i.atRisk);
      setDetail(lastStep, risk.length ? `${risk.map((i) => `${i.name}: ${i.daysOfCover} days left`).join(" · ")}. ${e.note}` : e.note);
      lastItems = e.report.items; renderItems();
      break;
    }
    case "step":
      rowsByUrl.set(e.url, e.kind === "data" ? (pendingRows.shift() ?? addStep("", "circle", e.why)) : addStep("", "circle", "Paying the supplier invoice via x402"));
      break;
    case "quote": setDetail(rowOf(e), `Costs ${money(e.priceUsd)} · checking your rules…`); break;
    case "paying": setDetail(rowOf(e), `Paying ${money(e.priceUsd)} via x402…`); break;
    case "paid": {
      paidLinks.set(e.url, { link: e.link, tx: e.tx });
      const row = rowOf(e);
      mark(row, "paid", "check");
      setDetail(row, e.kind === "order" ? `Paid ${usdc(e.priceUsd)} USDC into the supplier’s wallet · ` : `Paid ${money(e.priceUsd)} · `, receiptLink(e.link));
      break;
    }
    case "refused":
      mark(rowOf(e), "refused", "shield-alert");
      setDetail(rowOf(e), `Refused by your rules (${e.rule}): ${e.reason}. Nothing was signed.`);
      break;
    case "offer": {
      const paid = paidLinks.get(e.url) ?? {};
      offers.set(e.url, { quote: e.quote, ...paid });
      rowOf(e)?.querySelector(".detail")?.append(` · ${usdc(e.quote.totalUsd)} USDC, delivers in ${days(e.quote.deliveryDays)}${e.quote.allInStock ? "" : ", missing items"}`);
      renderQuotes();
      break;
    }
    case "demand":
      demand = { multiplier: e.multiplier, reason: e.reason, ...(paidLinks.get(e.url) ?? {}) };
      rowOf(e)?.querySelector(".detail")?.append(` · outlook ×${e.multiplier}`);
      renderQuotes();
      break;
    case "recommendation":
      addStep("", "hand", `Asked you to approve ${usdc(e.recommendation.totalUsd)} USDC to ${e.recommendation.supplier}`);
      renderRecommendation(e.recommendation);
      break;
    case "decision":
      if (e.approved) {
        $("orderStatus").textContent = "Paying via x402…";
        $("orderActions").hidden = true;
        stopCountdown();
      } else {
        $("orderStatus").className = "chip chip-warning";
        $("orderStatus").textContent = "Declined";
        settle({ ok: false, title: e.reason === "no answer in time" ? "No answer, so no order" : "Order declined", desc: "Nothing was signed or sent. Your balance is unchanged." });
      }
      break;
    case "unpaid":
      addStep("refused", "shield-alert", "The supplier invoice was NOT paid", e.reason);
      $("orderStatus").className = "chip chip-warning";
      $("orderStatus").textContent = "Refused by your rules";
      settle({ ok: false, title: "Not paid", desc: `${e.reason}. Nothing was signed.` });
      break;
    case "records": {
      const secs = approvedAt ? ((Date.now() - approvedAt) / 1000).toFixed(1) : null;
      addStep("paid", "check", `Records updated: delivery on ${e.order.deliveryDate}`, "Stock shows as incoming.");
      $("orderStatus").className = "chip chip-success";
      $("orderStatus").textContent = "Settled on Stellar";
      settle({ ok: true, title: `Paid ${usdc(e.order.totalUsd)} USDC${secs ? ` in ${secs}s` : ""}`,
               desc: `${rec?.supplier ?? "The supplier"} was paid on Stellar testnet. Delivery on ${e.order.deliveryDate}; stock shows as incoming.`,
               link: e.order.link, tx: e.order.tx });
      lastItems = e.items; renderItems();
      break;
    }
    case "error": {
      const row = rowsByUrl.get(e.url);
      if (row) { mark(row, "error", "x"); setDetail(row, `${e.message}${e.hint ? `. ${e.hint}` : ""}`); }
      else addStep("error", "x", e.message, e.hint);
      break;
    }
    case "fatal": addStep("error", "x", `Stopped: ${e.message}`); finish(); break;
    case "done": {
      const secs = Math.round((Date.now() - runStartedAt) / 1000);
      $("resultCard").hidden = false;
      $("summary").textContent = e.summary;
      $("resultChip").textContent = e.decision?.paid ? "Ordered" : e.decision ? "No order" : "Done";
      $("resultChip").className = `chip ${e.decision?.paid ? "chip-success" : "chip-primary"}`;
      $("resultMeta").textContent = `${secs}s · ${money(e.dataSpentUsd)} on data · wallet ${usdc(e.walletUsdc)} USDC`;
      $("activityChip").textContent = "Done";
      finish();
      break;
    }
  }
}

// ── Run ────────────────────────────────────────────────────
function start() {
  $("run").disabled = true;
  $("run").querySelector("span").textContent = "Korta is working…";
  $("introCard").hidden = true;
  $("timeline").replaceChildren();
  $("activityCard").hidden = false;
  $("activityChip").textContent = "Working";
  $("resultCard").hidden = true;
  $("recCard").hidden = true;
  $("approveEmpty").hidden = false;
  $("approveDot").hidden = true;
  lastStep = null; pendingRows = []; rowsByUrl.clear();
  offers.clear(); paidLinks.clear(); demand = null; rec = null; approvedAt = 0;
  renderQuotes();
  runStartedAt = Date.now();
  source = new EventSource(`/api/run?brain=${brain}`);
  source.onmessage = (m) => onEvent(JSON.parse(m.data));
  source.onerror = () => { if (source) { addStep("error", "x", "Lost connection to Korta."); finish(); } };
}

function finish() {
  source?.close();
  source = null;
  stopCountdown();
  $("run").disabled = false;
  $("run").querySelector("span").textContent = "Check my stock";
  loadShop();
}

function setBrain(b) {
  brain = b;
  document.querySelectorAll(".seg button").forEach((btn) => btn.setAttribute("aria-pressed", String(btn.dataset.brain === b)));
  $("brainNote").textContent = b === "ai"
    ? `AI brain: ${cfg.aiModel} decides; your rules still decide what gets paid.`
    : "Scripted brain: fixed decision rules, same tools, same wallet rules.";
}

function renderRules() {
  const p = cfg.policy;
  const rules = [
    `Every order needs your approval${cfg.pinRequired ? " (with your owner PIN)" : ""}. No answer within ${Math.round(p.approvalTimeoutSeconds / 60)} min means no.`,
    `Never pay more than you approved: if a supplier changes the price, nothing is signed.`,
    `Orders: at most ${usdc(p.orderMaxUsd)} USDC each, and never below your ${usdc(p.cashReserveUsd)} USDC cash reserve.`,
    `Quotes and data: auto-pay up to ${money(p.dataMaxPerRequestUsd)} each and ${money(p.dataBudgetPerRunUsd)} per run.`,
    `Daily limit across everything: ${usdc(p.dailyBudgetUsd)} USDC.`,
    `Only known suppliers and wallets get paid (${p.allowedHosts.join(", ")}).`,
    `Supplier text is data, never instructions.`,
  ];
  $("policy").replaceChildren(...rules.map((t) => h("li", {}, icon("shield-check"), h("span", { text: t }))));
  icons();
}

async function loadDemo() {
  const s = await fetch("/api/scenario").then((r) => r.json());
  if (!s.enabled) return;
  $("demoCard").hidden = false;
  $("scenario").replaceChildren(...Object.entries(s.scenarios).map(([k, label]) => h("option", { value: k, text: label })));
  $("scenario").value = s.scenario;
}

async function init() {
  cfg = await fetch("/api/config").then((r) => r.json());
  if (cfg.walletLink) $("walletLink").href = cfg.walletLink;
  const aiBtn = document.querySelector('[data-brain="ai"]');
  aiBtn.disabled = !cfg.aiAvailable;
  if (!cfg.aiAvailable) aiBtn.title = "Add OPENAI_API_KEY and OPENAI_MODEL to enable";
  setBrain(cfg.defaultBrain === "ai" && cfg.aiAvailable ? "ai" : "scripted");
  document.querySelectorAll(".seg button").forEach((btn) => btn.addEventListener("click", () => setBrain(btn.dataset.brain)));
  $("run").addEventListener("click", start);
  $("approve").addEventListener("click", () => answer(true));
  $("decline").addEventListener("click", () => answer(false));
  $("toggleItems").addEventListener("click", () => { showAll = !showAll; renderItems(); });
  $("themeToggle").addEventListener("click", () => {
    const dark = document.documentElement.classList.toggle("dark");
    try { localStorage.setItem("korta-theme", dark ? "dark" : "light"); } catch { /* storage blocked */ }
  });
  $("scenario").addEventListener("change", async (ev) => {
    await fetch("/api/scenario", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: ev.target.value }) });
  });
  $("reset").addEventListener("click", async () => {
    await fetch("/api/reset", { method: "POST" });
    $("activityCard").hidden = $("resultCard").hidden = $("recCard").hidden = true;
    $("approveEmpty").hidden = false;
    offers.clear(); demand = null; rec = null; renderQuotes();
    await Promise.all([loadShop(), loadDemo()]);
    goTo("overview");
  });
  window.addEventListener("hashchange", showTab);
  showTab();
  renderRules();
  renderQuotes();
  await Promise.all([loadShop(), loadDemo()]);
  icons();
}

init();
