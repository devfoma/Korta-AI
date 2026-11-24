// Preflight before a demo: wallets, facilitator and AI ready? Prints no secrets.
// Exits with code 1 if anything needs fixing. Adapted from the EmpowerHer x402 workshop kit.
import { Horizon, StrKey } from "@stellar/stellar-sdk";
import OpenAI from "openai";
import { config, explorer, agentPublicKey, aiAvailable } from "../src/config.mjs";

const horizon = new Horizon.Server(config.horizonUrl);
const { usdc, facilitator: fac } = config;

let failures = 0;
const short = (g) => `${g.slice(0, 6)}…${g.slice(-4)}`;
const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m, fix) => { failures++; console.log(`  ✗ ${m}${fix ? `\n      → ${fix}` : ""}`); };

async function checkWallet(label, pub, { pays }) {
  console.log(`\n${label} ${short(pub)}`);
  let acc;
  try { acc = await horizon.loadAccount(pub); ok("exists on the network"); }
  catch (e) { return e?.response?.status === 404 ? fail("not found", "run: npm run setup") : fail(`Horizon error: ${e.message}`); }
  const bal = acc.balances.find((b) => b.asset_code === usdc.code && b.asset_issuer === usdc.issuer);
  if (!bal) return fail(`no ${usdc.code} trustline`, "run: npm run setup");
  if (!pays) return ok(`${usdc.code} trustline · received so far: ${bal.balance}`);
  Number(bal.balance) >= config.policy.cashReserveUsd + 1
    ? ok(`${usdc.code} ${bal.balance}  ← hard spending limit`)
    : fail(`${usdc.code} balance is ${bal.balance}: too low for a restock (reserve ${config.policy.cashReserveUsd})`, `${usdc.faucetUrl} → Stellar Testnet → paste ${pub}`);
  console.log(`    ${explorer.account(pub)}`);
}

async function checkFacilitator() {
  console.log(`\nFacilitator (${fac.name}) ${fac.url}`);
  if (fac.keyUrl && !fac.apiKey) return fail(`FACILITATOR_${fac.name.toUpperCase()}_API_KEY is empty`, `free key: ${fac.keyUrl}`);
  const headers = fac.apiKey ? { Authorization: `Bearer ${fac.apiKey}` } : {};
  let res;
  try { res = await fetch(`${fac.url}/supported`, { headers, signal: AbortSignal.timeout(10_000) }); }
  catch (e) { return fail(`unreachable (${e.message})`, "switch FACILITATOR in .env"); }
  if (res.status === 401 || res.status === 403) return fail(`rejected the API key (HTTP ${res.status})`, fac.keyUrl ? `new key: ${fac.keyUrl}` : "check the key");
  if (!res.ok) return fail(`HTTP ${res.status}`, "switch FACILITATOR in .env");
  const { kinds = [] } = await res.json();
  const match = kinds.find((k) => k.network === config.network && k.scheme === "exact" && k.x402Version === 2);
  match ? ok(`supports exact on ${config.network}${match.extra?.areFeesSponsored ? " (fees sponsored)" : ""}`)
        : fail(`does not list ${config.network}`, "switch FACILITATOR in .env");
}

async function checkAi() {
  if (config.ai.brain !== "ai") return console.log("\nBrain: scripted (no AI model)");
  console.log(`\nBrain: OpenAI ${config.ai.model || "(no model set)"}`);
  if (!aiAvailable()) return fail("OPENAI_API_KEY or OPENAI_MODEL is empty", "add both to .env, or set KORTA_BRAIN=scripted");
  try { await new OpenAI({ apiKey: config.ai.apiKey }).models.retrieve(config.ai.model); ok("API key works and the model is available"); }
  catch (e) { fail(`OpenAI said: ${e.status ?? ""} ${e.message}`, e.status === 401 ? "check OPENAI_API_KEY" : "check OPENAI_MODEL"); }
}

console.log(`Korta preflight · ${config.network}`);
const agentPub = agentPublicKey();
if (!agentPub) fail("KORTA_AGENT_SECRET missing or not a secret key (S...)", "run: npm run setup");
else await checkWallet("Korta wallet", agentPub, { pays: true });
for (const [id, pub] of Object.entries(config.payees)) {
  if (!StrKey.isValidEd25519PublicKey(pub)) fail(`${id} payee wallet missing`, "run: npm run setup");
  else await checkWallet(id === "market" ? "Market data wallet" : `Supplier ${id.toUpperCase()} wallet`, pub, { pays: false });
}
await checkFacilitator();
await checkAi();

console.log(failures ? `\n✗ ${failures} thing(s) to fix before going live.\n` : "\n✓ Ready to demo.\n");
process.exit(failures ? 1 : 0);
