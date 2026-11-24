# Korta AI — 2-Day Build Plan

> **Goal:** in two days, ship a working, deployed demo where a team of AI agents restocks a small shop and
> pays for data and supplier orders with **x402 on Stellar testnet**, under the owner's rules.
> Companion doc: [PROJECT_BRIEF.md](PROJECT_BRIEF.md) (what we're building and why).

---

## 1. The refined idea (one breath)

**Korta AI keeps a small shop's shelves stocked.** Its agents spot stock that will run out, buy the market and
supplier data they need for a fraction of a cent each, and pay the chosen supplier's invoice in USDC, all via
x402 on Stellar, only within the owner's limits and only after the owner taps Approve.

We build **one flow end to end, very well: the Restock Run.** Everything else in the original Kora brief
(retention agent, passkeys, Soroban escrow, ZK) becomes roadmap.

### Why this wins the judging question ("Is x402 central?")

| Remove the payment and… | Result |
|---|---|
| Supplier quote APIs (paid per request, agents can't sign up or use cards) | No live prices → no comparison |
| Market demand feed (sub-cent per call) | No demand signal → worse forecast |
| Supplier invoice paid via x402 | No order is placed → no restock |

The product stops working without the payment. That's the test the workshop said judges will apply.

---

## 2. Scope

### Must-haves (the demo fails without these)

| # | Deliverable | Track |
|---|---|---|
| M1 | Seeded demo shop: 12 items, 30 days of sales, reorder settings, cash float | B |
| M2 | **Supplier Network** server: 3 suppliers + 1 market-data seller, each paid via x402 into its **own** Stellar wallet | A |
| M3 | **Owner spending policy** in code: data purchases auto-pay under a cap; orders always need approval; cash-reserve rule from the Finance Agent | A |
| M4 | **Five agents** in one pipeline: Inventory → Sales → Finance → Procurement → Business | B |
| M5 | **Korta dashboard**: shop status, live agent timeline, recommendation card with Approve / Decline | C |
| M6 | Real testnet USDC payments with **Stellar Expert receipt links** for every purchase | A |
| M7 | After payment: stock shows "incoming", cash ledger and order history update | B/C |
| M8 | Deployed on Render, warm and tested from a phone | C |
| M9 | README, 3-minute demo video, 5-slide pitch | C |

### Stretch (only if every must-have is green by Day 2, block 3)

- **S1 · On-chain allowance:** the owner wallet grants the agent a SEP-41 `approve` (cap + expiry ledger); the
  agent tops up its float with `transfer_from` just in time. "The network enforces the limit."
- **S2 · Retention Agent lite:** list top customers who haven't bought in 14 days and draft a message (no sending).
- **S3 · Policy editor in the UI:** owner changes caps and reserve days from the dashboard.
- **S4 · Second scenario:** "festive week" button that changes the demand signal and the recommendation.

### Out (say so in the pitch, as roadmap)

Passkeys / smart wallets · Soroban escrow for supplier agreements · mainnet · POS / WhatsApp · multi-shop auth ·
MPP sessions · ZK / confidential tokens · real supplier integrations.

---

## 3. Architecture

### Starting point

We build on the **EmpowerHer x402 workshop kit** (github.com/KoxyG/x402-stellar-empower-Her), credited in the
README. It already gives us, tested on Stellar testnet:

- `@x402/*` 2.30.0 seller middleware and paying client, `@stellar/stellar-sdk` 16, Node 22, Express
- The **wallet with layered rules** (allowlist, per-request cap, task budget, daily budget, human approval with
  timeout, "pay at most the quoted amount"), spend log, explorer links
- AI planner loop (OpenAI tool calling, limits *not* in the prompt) + scripted fallback brain
- SSE console with Approve / Decline, wallet setup script, preflight check, Render one-service start

**Verified before planning:** x402 v2.30.0 supports **dynamic `price` and dynamic `payTo`** per request
(`(context: { path, method, adapter, … }) => Price`), so one route can bill each order's real total into
the right supplier's wallet.

### Shape of the system

```
 Owner (phone/laptop)
   │  Run daily check · Approve / Decline
   ▼
 Korta console  (Express + SSE)                         src/console/
   │
   ▼
 Business Agent ── runs the team ──────────────────────── src/agents/team.mjs
   ├─ Inventory Agent   (code)  days of cover vs lead time → items to restock
   ├─ Sales Agent       (code)  14-day forecast; buys market demand signal ─┐
   ├─ Finance Agent     (code)  cash − reserve → restock budget → policy    │ x402
   ├─ Procurement Agent (LLM)   buys quotes, compares, drafts order ────────┤ payments
   └─ Business Agent    (LLM)   one recommendation → owner approval         │
                                       │ approved                           │
                                       └─ pays supplier invoice ────────────┤
                                                                            ▼
 Korta wallet (rules in code, never in the prompt)          src/wallet/
   allowlist · per-request cap · run budget · daily budget · cash reserve
   · approval for orders · pay ≤ quoted amount · wallet balance (hard limit)
                                                                            │
                                                                            ▼
 Supplier Network (x402 seller)                             src/suppliers/
   3 suppliers + market data, each with its own payTo wallet
                                                                            │ verify + settle
                                                                            ▼
 Facilitator (OpenZeppelin "Built on Stellar" or Coinbase) → Stellar testnet (USDC)
```

### Repo layout (target)

```
src/
  config.mjs              kit config + Korta settings (wallets, policy)
  wallet/index.mjs        kit's createWallet(), generalised: GET/POST, data vs order rules
  agents/
    inventory.mjs         pure functions, no AI
    sales.mjs             pure forecast + one paid market call
    finance.mjs           pure: budget + reserve → policy for this run
    procurement.mjs       LLM tool loop (scripted fallback)
    business.mjs          LLM recommendation (template fallback)
    team.mjs              runRestock(emit, approve): the pipeline
  suppliers/server.mjs    Supplier Network (x402 seller)
  store/shop.mjs          read/write shop.json; resetDemo()
  console/app.mjs         SSE run + approve + reset endpoints
  console/public/         Korta dashboard (vanilla HTML/CSS/JS, no build step)
data/shop.seed.json       committed demo data (runtime copy data/shop.json is git-ignored)
scripts/setup.mjs         creates + funds 5 wallets, adds USDC trustlines
scripts/check.mjs         preflight
scripts/start.mjs         one-process start for Render
```

### Contracts to freeze in the first hour (so tracks can work in parallel)

**Supplier Network API**

| Route | Price | payTo | Returns |
|---|---|---|---|
| `GET /directory` | free | — | suppliers: id, name, categories, wallet |
| `GET /suppliers/:id/quote?items=rice-50kg:4,oil-5l:2` | $0.002 | that supplier | unit prices, stock, delivery ETA, `quoteId` (valid 10 min) |
| `POST /suppliers/:id/orders` `{quoteId}` | free | — | `orderId`, `totalUsd`, `payPath` |
| `POST /suppliers/:id/orders/:orderId/pay` | **dynamic = order total** | **dynamic = that supplier** | `status: paid`, delivery ETA |
| `GET /market/demand?category=staples&area=lagos` | $0.005 | market wallet | demand multiplier + reason |
| `POST /demo/price-jump/:id` (dev only) | free | — | raises that supplier's price after quoting, for the guardrail demo |

If POST payments fight the kit's client, fall back to `GET …/pay` (the kit already pays GETs).

**Shop data (`data/shop.seed.json`)**
`shop {name, area, currency}` · `items[] {id, name, unit, stock, packSize, leadTimeDays, safetyDays, category}`
· `sales[] {date, itemId, qty}` (30 days) · `ledger[] {at, type, amountUsd, memo, tx}` · `orders[]` ·
`policy {reserveUsd, maxOrderUsd, dataAutoPayUsd}`

**Event stream (SSE)** — the kit's events (`quote`, `paying`, `paid`, `refused`, `approval`, `error`, `done`)
plus `agent {role, status: working|done, summary}`, `recommendation {supplier, lines[], totalUsd, cashAfterUsd, reasons[]}`,
`records {stock, ledger, order}`.

### Agent logic (keep it simple and explainable)

- **Inventory:** `dailyRate` = average of last 14 days; `daysOfCover = stock / dailyRate`; restock if
  `daysOfCover < leadTimeDays + safetyDays`; quantity covers 14 days, rounded up to `packSize`.
- **Sales:** weighted moving average × demand multiplier bought from `/market/demand` (one call per category flagged).
- **Finance:** `restockBudget = min(policy.maxOrderUsd, walletUsdc − policy.reserveUsd)`; this becomes the
  order cap the wallet enforces for this run. The AI never sees the number.
- **Procurement (LLM):** tools `list_suppliers` (free), `buy_quote(supplierId, items, reason)` (paid),
  `propose_order(supplierId, quoteId, reason)`. One supplier per order in the MVP. **Scripted fallback:** buy all
  three quotes, pick the cheapest total that has everything in stock within lead time.
- **Business (LLM):** writes the owner-facing recommendation (≤ 4 sentences + line items). Template fallback.
- **Approval:** reuses the kit's approve-with-timeout (raise to 300 s for orders; silence = decline).

### Money at demo scale

Testnet faucet USDC is limited, so seed prices keep **order totals between 1 and 5 USDC** and data calls at
$0.002–$0.005. Label it on screen: "Stellar testnet · demo-scale prices". Fund the agent wallet with ~20 USDC
on Day 1 and top up before rehearsals.

---

## 4. Schedule

Blocks are ~2 hours. Each block ends with a commit + push. Tracks: **A** money path · **B** agents · **C** product & demo.
Working solo: do the blocks top to bottom. Two people: one takes A+B, one takes C.

### Day 1 — make the money move (ugly is fine)

| Block | A · Money path | B · Agents | C · Product & demo |
|---|---|---|---|
| **1** | Import kit, rename to Korta, `npm install`; extend `setup` to 5 wallets (agent, 3 suppliers, market) + trustlines; faucet USDC; pick facilitator; `npm run check` ✓ | Freeze the 3 contracts above; write `shop.seed.json` (12 items, 30 days sales, 2–3 items deliberately low) | Pre-flight accounts (OpenAI key, OpenZeppelin testnet key, Render ↔ GitHub); dashboard wireframe (phone first) |
| **2** | **Spike first 30 min:** dynamic price + payTo on one route. Then Supplier Network: directory, quote, orders, pay, market | `store/shop.mjs` + Inventory and Finance agents as pure functions, with a quick sanity script | Dashboard skeleton: shop panel (items, days of cover bars, cash, wallet USDC) from `/api/shop` |
| **3** | Generalise wallet: POST support, data-vs-order rules, run-level order cap from Finance, spend log categories | Sales agent (forecast + paid market call); `team.mjs` pipeline emitting `agent` events | Agent timeline component: 5 agent cards lighting up from SSE |
| **4** | End-to-end from terminal: `npm run restock` → real quote payments + one approved order payment on testnet | Procurement LLM loop + scripted fallback; Business agent recommendation + template fallback | Recommendation card + Approve / Decline wired to `/api/approve` |
| **5** | Fix what broke; record tx links | Records update after pay (stock incoming, ledger, order) | Receipts list with explorer links |

**Day 1 exit check:** from the terminal, one restock run buys a demand signal and three quotes, the owner approves,
the supplier invoice is paid on testnet, and every payment has a working Stellar Expert link.
If this isn't true, Day 2 block 1 does nothing else.

### Day 2 — make it a product, then make it a pitch

| Block | A · Money path | B · Agents | C · Product & demo |
|---|---|---|---|
| **1** | Guardrail scenarios: price jump after quote (Layer 2 refuses, nothing signed), order over cap, cash-reserve breach, injected text in a supplier reply | Tune prompts and reasons so the recommendation reads like a helpful shop assistant | Full flow in the browser; "Reset demo" button; testnet + demo-scale labels |
| **2** | Render deploy (one service, `npm start`), env vars, warm-up | Edge cases: supplier out of stock, AI timeout → scripted brain | Mobile polish; empty and error states |
| **3** | **Gate:** all must-haves green? If yes, pick **one** stretch (S1 recommended) | Help on stretch or bugs | README with screenshots, architecture diagram, safety notes |
| **4** | Rehearse demo ×3 on the live URL; fix flakiness | Rehearse; record backup tx links | Record the 3-minute video; build the 5-slide pitch |
| **5** | Buffer | Buffer | Submit: repo, live URL, video, pitch |

---

## 5. Demo script (3 minutes)

| Time | Show | Say |
|---|---|---|
| 0:00 | Title | "Small shops lose sales every time fast-moving stock runs out. Korta AI is an operations team that never sleeps." |
| 0:20 | Dashboard | Rice and oil are red: 3 days of cover, 2-day lead time. Wallet holds test USDC. |
| 0:35 | **Run daily check** | Agents light up in order. Sales buys a demand signal ($0.005) → tx link. Finance sets the budget. Procurement buys 3 quotes ($0.002 each). |
| 1:30 | Recommendation | "Order 4 bags of rice and 2 cartons of oil from Supplier B, 4.20 USDC, delivery tomorrow, cash stays above reserve." **Approve.** |
| 1:50 | Receipt | Paid via x402 into Supplier B's own wallet; open Stellar Expert; stock now shows incoming. |
| 2:10 | Guardrail | Supplier raises its price after quoting → refused, nothing signed. "The AI proposes; the owner's rules decide." |
| 2:30 | Close | Remove-the-payment test; roadmap: passkeys, Soroban escrow, mainnet. |

---

## 6. Risks and fallbacks

| Risk | Fallback |
|---|---|
| Facilitator down or slow | Switch `FACILITATOR=primary` ↔ `backup` (one env line) |
| OpenAI slow or unavailable | Scripted brain for Procurement, template for Business Agent (toggle in UI) |
| Dynamic pricing misbehaves | Fixed-price order bundles per supplier (small / medium / large) |
| Faucet limits | Demo-scale prices; fund early; keep a second funded agent wallet in reserve |
| Render free tier sleeps | Open the URL 15 min before; backup video; local run ready |
| Settlement reported as failed but lands on chain | Check explorer; make order status idempotent (check before re-paying) |
| Scope creep | The Out list is final until the Day 2 block 3 gate |

---

## 7. Before we start (checklist)

- [ ] Node.js 22+ on every machine
- [ ] OpenAI API key with access to the model we pick (the kit was tested with `gpt-5.4-mini`)
- [ ] OpenZeppelin testnet facilitator key (channels.openzeppelin.com/testnet/gen), or use Coinbase `backup` (no key)
- [ ] Render account connected to the `devfoma` GitHub account
- [ ] Circle faucet (faucet.circle.com → Stellar Testnet) ready for the agent wallet

## 8. Working rules

- Commits are authored by **devfoma**; no AI co-author trailers.
- Small commits, push at the end of every block; `main` stays runnable.
- `.env` is never committed or shown on screen (wallet secrets + API keys). Testnet only.
- Spending limits live in code and `.env`, **never** in an AI prompt.
- Every on-screen payment shows its Stellar Expert link.
