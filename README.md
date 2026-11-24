# Korta AI

**One AI agent that keeps a small shop's shelves stocked: it sources, compares and pays suppliers on Stellar.**

Korta checks the shop's stock against its sales, works out what will run out before the next delivery could
arrive, buys live supplier quotes for a fraction of a cent each, picks the best offer and, once the owner
approves, pays the supplier invoice in USDC — all machine-to-machine with **x402 on Stellar**, only within the
owner's spending rules.

> The AI proposes. The owner's rules decide. Stellar settles.

⚠️ **Stellar testnet only.** All payments use test USDC with no real value.

## What Korta does

1. Checks stock: which fast movers run out before a delivery could arrive
2. Buys a local demand signal via x402, only when it's worth the price
3. Buys quotes from suppliers via x402 and compares arrival time, cost and stock
4. Proposes one order, with the reasons and an offer comparison
5. On the owner's approval, pays the supplier invoice via x402 and updates the records

Limits live in code, never in the AI prompt, and a scenario suite checks the agent's judgment and safety.

## Docs

- [Project brief](docs/PROJECT_BRIEF.md) · [PDF](docs/Korta_AI_Project_Brief.pdf)
- [2-day build plan](docs/BUILD_PLAN.md)

## Status

🚧 Hackathon build in progress (EmpowerHer: Building the Agent Economy). Setup and run instructions land with
the first code drop.

## Credits

Built on the [EmpowerHer x402-on-Stellar workshop kit](https://github.com/KoxyG/x402-stellar-empower-Her) by Koxy,
and Stellar's [x402 docs](https://developers.stellar.org/docs/build/agentic-payments/x402).
