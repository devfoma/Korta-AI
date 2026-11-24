# Korta AI — Project Brief

**One AI agent that keeps a small shop's shelves stocked: it sources, compares and pays suppliers on Stellar.**

*Version 3 · November 2026 · formerly "Kora" · refocused on one core agent (mentor feedback) for a 2-day build
(EmpowerHer: Building the Agent Economy, x402 on Stellar).*

---

## Project overview

Korta is an AI restock agent for informal and small businesses. It watches the shop's stock against its sales,
works out what will run out before the next delivery could arrive, buys live quotes from suppliers, picks the
best offer and, once the owner approves, pays the supplier in USDC on Stellar. Every payment goes through the
owner's spending rules, and every order waits for the owner's approval.

**The AI proposes. The owner's rules decide. Stellar settles.**

## Problem statement

Small retailers and market traders run out of fast-moving stock at the worst moments, over-order slow items,
and pay suppliers by cash or bank transfer with no clear record. They rarely have time to call three suppliers
for prices, so they reorder from whoever they called last. The result: lost sales, tied-up cash and avoidable
losses.

## Proposed solution: one agent, done well

Instead of a team of half-finished agents, Korta is **one agent with one job: never let a fast-moving item run
out, without overspending.** It does that job end to end and explains every decision.

The checks a business team would do are plain, tested code that the agent calls as tools:

| Tool | What it does | Cost |
|---|---|---|
| `check_stock` | Days of cover per item vs supplier lead time; suggested quantities | free (code) |
| `list_suppliers` | Who sells what, and where | free |
| `buy_quote` | A supplier's live prices, stock and delivery time | ~$0.002 via x402 |
| `buy_demand_signal` | Local demand outlook (e.g. a festive-week spike), only when worth it | $0.005 via x402 |
| `check_budget` | Whether an order fits the owner's cash reserve | free (code) |
| `propose_order` | Sends the recommendation to the owner for approval | free |

The supplier invoice is paid by the wallet **after** the owner approves, never by the AI directly.

## What Korta does (the restock run)

1. **Checks stock:** rice and cooking oil will run out in 3 days; supplier lead times are 1–4 days.
2. **Decides what data is worth buying:** demand is unusual this week, so it buys a demand signal ($0.005) that
   shows a festive spike. On a normal week it skips it and saves the money.
3. **Buys quotes** from the suppliers that carry these items ($0.002 each via x402).
4. **Compares on what matters:** total cost, stock and whether delivery arrives before the shelf is empty.
5. **Proposes:** *"Order 4 bags of rice and 2 cartons of oil from Supplier B — 4.20 USDC. Supplier A is 0.30
   cheaper but delivers in 4 days, and you run out of rice in 3."*
6. **Pays on approval:** the owner taps Approve; the supplier invoice is paid via x402 straight into that
   supplier's Stellar wallet; the receipt links to the public ledger; stock and cash records update.

## Why x402 is central (the "remove the payment" test)

Korta pays machine-to-machine with **x402 on Stellar** in two places:

1. **Pay-per-request data.** Supplier quotes and demand signals cost a fraction of a cent. Agents can't fill in
   sign-up forms or enter card numbers, and card fees make sub-cent purchases impossible.
2. **Supplier settlement.** The approved invoice is paid via x402 in USDC, with a public receipt.

Remove the payment and Korta can't get live quotes or pay the supplier, so the restock never happens.
The payment is the product, not decoration.

## Built to be trusted

Limits live in code, never in the AI prompt, so the agent can't be talked out of them:

- Only allow-listed suppliers can be paid; data purchases have a per-request cap and a per-run budget.
- Every order needs the owner's approval; silence means no.
- Orders can't break the owner's cash reserve or the per-order cap.
- The wallet pays at most the quoted price: if a supplier raises the price after quoting, nothing is signed.
- Supplier text is treated as data, never as instructions.
- The wallet's own balance is the hard limit.

"Done well" is measured, not claimed: a scenario suite (normal restock, cheapest-but-too-slow, out of stock,
price jump, reserve breach, prompt injection, stable vs festive demand) runs against the agent and must pass
before the demo.

## Stellar integration

| Feature | In the 2-day MVP | Later |
|---|---|---|
| **Payments and stablecoins** | USDC on Stellar testnet for data purchases and supplier invoices | Mainnet; local-currency anchors for cash-out |
| **Agentic payments (x402)** | The agent pays within owner limits: allowlist, caps, run and daily budgets, cash reserve, approval for orders | MPP sessions for high-frequency data |
| **Soroban** | Every x402 payment is a SEP-41 token-contract transfer authorised by a signed Soroban auth entry | Supplier-agreement contracts (escrow, delivery-conditional release); on-chain allowances with cap and expiry |
| **Passkeys and smart wallets** | — | Passkey sign-in and smart-account spending policies, so owners never handle seed phrases |

*Future exploration: zero-knowledge proofs and confidential tokens for financial privacy.*

## Target users

Small retailers, provision stores, market traders, online vendors and other informal or small businesses that
restock frequently from several suppliers and want affordable, intelligent help without technical knowledge.

## Key objectives

- Prevent stock-outs of fast-moving items.
- Turn the owner's own sales data into clear, explained restocking decisions.
- Make supplier payments fast, cheap and traceable with USDC on Stellar.
- Let the agent spend only within limits the owner sets, and keep the owner in control of every order.

## Hackathon MVP (2-day scope)

**In:** one demo shop with seeded stock, sales and cash; the Korta restock agent with the six tools above;
three supplier APIs and one demand-signal API, each charging via x402 into its own Stellar wallet; owner
spending policy and approval; a scenario test suite; a phone-friendly dashboard with the agent's reasoning,
an offer comparison and on-chain receipts; a deployed demo.

**Out (roadmap):** additional agents, passkeys and smart wallets, Soroban escrow contracts, mainnet, POS and
WhatsApp integrations, multi-shop accounts, MPP sessions, ZK privacy.

All payments run on **Stellar testnet** with test USDC.

## Roadmap: from one agent to a team

Once restocking is excellent, the same wallet and rules can serve more agents: a Finance agent for cash-flow
planning, a Sales agent for pricing and promotions, and a Customer Retention agent for repeat buyers, each
earning its place the way Korta did.

## Expected impact

Fewer stock-outs, less cash tied up in the wrong stock, and supplier payments that settle in seconds with a
public receipt, so small businesses move from reactive record-keeping to proactive, AI-assisted operations.

## Project vision

**To make intelligent business management and accessible digital financial services available to every small
business, regardless of size, technical expertise or resources.**
