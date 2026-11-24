# Korta AI — Project Brief

**An AI operations team for small businesses that keeps shelves stocked and pays suppliers on Stellar.**

*Formerly "Kora". Version 2 — refined for a 2-day hackathon build (EmpowerHer: Building the Agent Economy, x402 on Stellar).*

---

## Project overview

Korta AI is a multi-agent business operations assistant for informal and small businesses. A small team of
specialised AI agents watches the shop's stock, sales and cash, works out what needs restocking, buys the
market and supplier data it needs, and pays suppliers in USDC on Stellar. Every payment goes through the
owner's spending rules, and anything that matters waits for the owner's approval.

**The AI proposes. The owner's rules decide. Stellar settles.**

## Problem statement

Small retailers and market traders run out of fast-moving stock at the worst moments, over-order slow items,
and pay suppliers by cash or bank transfer with no clear record. They rarely have time to call three
suppliers for prices, and they have no tools that turn their own sales history into a restocking decision.
The result: lost sales, tied-up cash and avoidable losses.

## Proposed solution

Korta AI gives the owner a coordinated team of agents, led by a central **Business Agent**:

| Agent | What it does | 2-day build |
|---|---|---|
| **Inventory Agent** | Flags items that will run out before the next delivery could arrive | ✅ |
| **Sales Agent** | Forecasts demand from sales history; buys a local demand signal when it helps | ✅ |
| **Finance Agent** | Works out how much cash can safely go to restocking and sets the spend policy | ✅ |
| **Procurement Agent** | Buys live quotes from suppliers, compares them and places the order | ✅ |
| **Business Agent** | Combines everything into one restock recommendation for the owner | ✅ |
| Customer Retention Agent | Finds lapsed customers and drafts follow-ups | Roadmap |

## Why x402 is central (the "remove the payment" test)

Korta AI's agents pay machine-to-machine with **x402 on Stellar** in two places:

1. **Pay-per-request data.** Supplier quote APIs and local market-demand feeds charge a fraction of a cent per
   request. Agents can't fill in sign-up forms or enter card numbers, and card fees make sub-cent purchases
   impossible. x402 is how the agent gets that data at all.
2. **Supplier settlement.** Once the owner approves, the Procurement Agent pays the supplier's order invoice
   via x402 in USDC, straight to that supplier's Stellar wallet, with a public receipt.

Remove the payment and Korta AI can't get live quotes or pay the supplier, so the restock never happens.
The payment is the product, not decoration.

## Stellar integration

| Feature | In the 2-day MVP | Later |
|---|---|---|
| **Payments and stablecoins** | USDC on Stellar testnet for data purchases and supplier orders | Mainnet, local-currency anchors for cash-out |
| **Agentic payments (x402)** | Agents pay within owner limits: allowlist, per-request cap, per-run budget, daily budget, cash-reserve rule, human approval for orders | MPP sessions for high-frequency data |
| **Soroban** | Every x402 payment is a SEP-41 token-contract transfer authorised by a signed Soroban auth entry | Supplier-agreement contracts (escrow, delivery-conditional release), on-chain allowances with cap and expiry |
| **Passkeys and smart wallets** | — | Passkey sign-in and smart-account spending policies so owners never handle seed phrases |

*Future exploration: zero-knowledge proofs and confidential tokens for financial privacy.*

## How Korta AI works (the restock run)

1. **Inventory Agent** sees rice and cooking oil will run out in 3 days; the supplier lead time is 2 days.
2. **Sales Agent** forecasts the next 14 days from sales history and buys a local demand signal
   ($0.005 via x402) that shows a festive-week spike.
3. **Finance Agent** checks cash and the safety reserve and sets the most this restock may spend.
4. **Procurement Agent** buys live quotes from three suppliers ($0.002 each via x402) and compares
   price, stock and delivery time.
5. **Business Agent** proposes: *"Order 4 bags of rice and 2 cartons of oil from Supplier B — 4.20 USDC,
   delivery tomorrow, cash stays above your 7-day reserve."*
6. The owner taps **Approve**. The Procurement Agent pays the supplier invoice via x402; USDC settles on
   Stellar in seconds; the receipt links to the public ledger, and stock and cash records update.

Guardrails live in code, not in the AI prompt: if a supplier raises the price after quoting, nothing is
signed; if an order breaks the cash reserve or the cap, it is refused; text from a supplier is treated as
data, never as instructions.

## Target users

Small retailers, provision stores, market traders, online vendors and other informal or small businesses
that restock frequently from several suppliers and want affordable, intelligent help without technical
knowledge.

## Key objectives

- Prevent stock-outs of fast-moving items.
- Turn the owner's own sales and cash data into clear restocking decisions.
- Make supplier payments fast, cheap and traceable with USDC on Stellar.
- Let agents spend autonomously only within limits the owner sets.
- Keep the owner in control of every decision that matters.

## Hackathon MVP (2-day scope)

**In:** one demo shop with seeded stock, sales and cash; five agents in one coordinated restock run;
three supplier APIs and one market-data API, each charging via x402 into its own Stellar wallet;
owner spending policy and approval; live dashboard with agent timeline and on-chain receipts; deployed demo.

**Out (roadmap):** Customer Retention Agent, passkeys and smart wallets, Soroban escrow contracts,
mainnet, POS and WhatsApp integrations, multi-shop accounts, MPP sessions, ZK privacy.

All payments run on **Stellar testnet** with test USDC.

## Expected impact

Korta AI moves small-business management from reactive record-keeping to proactive, AI-assisted operations:
fewer stock-outs, less cash tied up in the wrong stock, and supplier payments that settle in seconds with a
public receipt.

## Project vision

**To make intelligent business management and accessible digital financial services available to every
small business, regardless of size, technical expertise or resources.**
