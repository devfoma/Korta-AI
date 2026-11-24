<p align="center"><img src="src/console/public/brand/korta-logo.svg" alt="Korta" width="320"></p>

# Korta AI

**One AI agent that keeps a small shop's shelves stocked: it sources, compares and pays suppliers on Stellar.**

Korta checks the shop's stock against its sales, works out what will run out before the next delivery could
arrive, buys live supplier quotes for a fraction of a cent each, picks the best offer and, once the owner
approves, pays the supplier invoice in USDC — all machine-to-machine with **x402 on Stellar**, only within the
owner's spending rules.

> The AI proposes. The owner's rules decide. Stellar settles.

⚠️ **Stellar testnet only.** All payments use test USDC with no real value.

## What Korta does

1. **Checks stock:** which fast movers run out before a delivery could arrive
2. **Buys a demand signal** via x402 ($0.005), only when this week's sales look unusual
3. **Buys quotes** from each supplier via x402 ($0.002 each) and compares arrival time, cost and stock
4. **Proposes one order** to the owner, with the reasons and an offer comparison
5. **On approval, pays the supplier invoice** via x402 straight into the supplier's wallet, and updates the records

Remove the payment and Korta can't get quotes or pay the supplier, so the restock never happens.

## Built to be trusted

The owner's rules live in code ([src/wallet/index.mjs](src/wallet/index.mjs)), never in the AI prompt:

| Rule | What it stops |
|---|---|
| Allowlisted hosts + known payee wallets | Paying anyone Korta wasn't set up to pay |
| Data: per-request cap and per-run budget | Runaway spending on quotes and data |
| Orders: owner approval, per-order cap, cash reserve | Orders the owner didn't agree to or can't afford |
| Pay at most the approved amount | A supplier raising the price after the owner said yes |
| Daily budget across everything | Slow leaks over many runs |
| Wallet balance | Everything else: it can't spend what it doesn't hold |

Supplier text is treated as data, never as instructions. A failed network call never changes what gets ordered.

## Quick start (about 10 minutes)

You need **Node.js 22+**.

```bash
npm install
npm run setup     # creates .env and 5 testnet wallets (Korta + 3 suppliers + market data)
```

Give Korta test USDC: open https://faucet.circle.com, choose **Stellar Testnet**, paste the Korta address that
setup printed. Then:

```bash
npm run check     # ✓ Ready to demo.
npm start         # Supplier Network on :4021 + Korta dashboard on http://localhost:4022
```

Open http://localhost:4022 and tap **Check my stock**.

**AI brain (optional):** add `OPENAI_API_KEY`, `OPENAI_MODEL` and `KORTA_BRAIN=ai` to `.env`. Without them the
scripted brain runs the same tools under the same rules.

### Other commands

```bash
npm run restock                 # a run in the terminal (asks y/N before ordering)
npm run restock -- --decline    # …and always decline (spends only on data)
npm test                        # stock maths, budget rules and 12 offline scenarios (no network, no money)
npm run eval                    # 8 scenarios as real testnet runs (needs npm start; ~$0.08 test USDC)
npm run eval -- --brain ai      # the same, judged with the AI brain
```

**Proof it works well:** [eval/results.md](eval/results.md) has the latest testnet eval, with a receipt link per run.

### Demo scenarios

In the dashboard, open **Demo controls** to switch what the suppliers do:

| Scenario | What Korta should do |
|---|---|
| Default | Pick Bola (delivers tomorrow) over Adeyemi (0.30 cheaper, but arrives after rice runs out) |
| Everyone delivers tomorrow | Pick the cheapest |
| Supplier B is out of rice | Switch to Coastline |
| Supplier B raises its price after quoting | Owner approves 4.20, invoice says 4.62 → refused, nothing signed |
| Injected instructions in a quote | Ignore them |
| Normal demand | Smaller order (no festive uplift) |

**Reset demo shop** puts the stock back.

## Deploy (Render, free plan)

1. Render → **New → Blueprint** → pick this repo. It reads [render.yaml](render.yaml).
2. Paste the values it asks for from your local `.env`: `KORTA_AGENT_SECRET`, the four payee addresses, and
   optionally `OPENAI_API_KEY` / `OPENAI_MODEL`.
3. Set **`KORTA_OWNER_PIN`**: on a public URL anyone can open the dashboard, but only someone with the PIN can
   approve a payment. Declining never needs it.
4. Deploy, then open the `…onrender.com` link. The free plan sleeps after 15 minutes idle: open it a few
   minutes before a demo.

One run at a time; the daily budget on Render is lower (12 USDC) because anyone with the link can start a run.

## How it's built

```
src/
  agent/        Korta: tools, AI brain (OpenAI), scripted brain, stock + budget + offer maths
  wallet/       x402 paying client + the owner's rules
  suppliers/    the Supplier Network: x402 sellers, each paid into its own wallet
  console/      the owner's dashboard (Express + SSE, vanilla JS)
  store/        the shop's records (JSON file)
scripts/        setup, check, seed, start
test/           unit + offline scenario tests
```

## Troubleshooting

- **`npm run check` says the balance is too low:** top up at https://faucet.circle.com (Stellar Testnet).
- **"payment not confirmed … txInsufficientFee":** the facilitator rejected simultaneous settlements. Korta
  settles one payment at a time; if you see this, make sure only one Korta process uses the wallet.
- **A first paid request fails with HTTP 500:** the Supplier Network couldn't reach the facilitator at startup.
  Korta retries automatically; if it persists, check your connection or switch `FACILITATOR` in `.env`.
- **Port in use:** stop the other process, or change `PORT` / `CONSOLE_PORT` / `SUPPLIERS_BASE_URL` in `.env`.

## Docs

- [Project brief](docs/PROJECT_BRIEF.md) · [PDF](docs/Korta_AI_Project_Brief.pdf)
- [2-day build plan](docs/BUILD_PLAN.md)

## Credits

Built on the [EmpowerHer x402-on-Stellar workshop kit](https://github.com/KoxyG/x402-stellar-empower-Her) by Koxy,
and Stellar's [x402 docs](https://developers.stellar.org/docs/build/agentic-payments/x402).
