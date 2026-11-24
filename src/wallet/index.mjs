// Korta's wallet: every call to the Supplier Network goes through here.
// The AI can ASK to buy; these rules, in code, decide. The AI is never told the numbers.
//
//   Data purchases (quotes, demand signal) pay automatically when ALL of these pass:
//     allowlisted host · known payee wallet · ≤ per-request cap · ≤ per-run data budget · ≤ daily budget
//   Supplier invoices are paid only AFTER the owner approved, and only when ALL of these pass:
//     allowlisted host · known payee wallet · ≤ the approved amount (price can't move after approval)
//     · ≤ per-order cap · wallet keeps the cash reserve · ≤ daily budget
//   Layer 2: the x402 client signs at most the amount we approved.
//   Layer 3: the wallet's USDC balance is the hard limit.
// Adapted from the EmpowerHer x402 workshop kit (src/agent.mjs).
import fs from "node:fs";
import { Keypair, Horizon } from "@stellar/stellar-sdk";
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { config, explorer, toUnits, toUsd } from "../config.mjs";

const { usdc, policy } = config;
const horizon = new Horizon.Server(config.horizonUrl);
const knownPayees = new Set(Object.values(config.payees).filter(Boolean));

let agentPub = null;
let signer = null;
try {
  agentPub = Keypair.fromSecret(config.agentSecret).publicKey();
  signer = createEd25519Signer(config.agentSecret, config.network);
} catch { /* reported by walletAddress() callers and npm run check */ }

export const walletAddress = () => agentPub;

export async function walletUsdc() {
  if (!agentPub) return 0;
  const acc = await horizon.loadAccount(agentPub);
  const bal = acc.balances.find((b) => b.asset_code === usdc.code && b.asset_issuer === usdc.issuer);
  return Number(bal?.balance ?? 0);
}

// ── Daily spend log: survives between runs, so the daily budget holds ──
const today = () => new Date().toISOString().slice(0, 10); // UTC date
const readSpendLog = () => { try { return JSON.parse(fs.readFileSync(policy.spendLogFile, "utf8")); } catch { return []; } };
const spentTodayUnits = () => readSpendLog().filter((e) => e.date === today()).reduce((sum, e) => sum + BigInt(e.units), 0n);
export const spentTodayUsd = () => toUsd(spentTodayUnits());
const appendSpendLog = (entry) => fs.writeFileSync(policy.spendLogFile, JSON.stringify([...readSpendLog(), entry], null, 2));

// Read the price out of a 402 WITHOUT paying.
function readQuote(res) {
  const header = res.headers.get("PAYMENT-REQUIRED");
  if (!header) return null;
  const { resource, accepts } = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  const offer = accepts.find((o) => o.network === config.network && o.asset === usdc.contractId);
  return offer && { units: BigInt(offer.amount), priceUsd: toUsd(offer.amount), payTo: offer.payTo, description: resource?.description };
}

// A fetch that signs at most `approvedUnits` (Layer 2). The client's own per-payment cap defaults to $1,
// so it is set explicitly to the cap for this kind of payment.
function payingFetch(approvedUnits, capUsd) {
  return wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: config.network, client: new ExactStellarScheme(signer, { url: config.rpcUrl }) }],
    policies: [(_version, offers) => offers.filter((o) => BigInt(o.amount) <= approvedUnits)],
    spendControls: { maxAmountPerPayment: capUsd },
  });
}

const fail = (rule, reason) => ({ ok: false, rule, reason });
const pass = (reason) => ({ ok: true, rule: "within limits", reason });

function commonChecks(url, quote, todayUnits) {
  const host = new URL(url).host;
  if (!policy.allowedHosts.includes(host)) return fail("allowlist", `${host} is not on the allowlist`);
  if (!knownPayees.has(quote.payTo)) return fail("unknown payee", "the payment would go to a wallet that isn't a known supplier");
  if (todayUnits + quote.units > toUnits(policy.dailyBudgetUsd)) return fail("daily budget", "would go over today's spending limit");
  return null;
}

// ── The wallet for one restock run ─────────────────────────
// emit(event) reports every step so the terminal and the dashboard can show it live.
export function createWallet(emit = () => {}) {
  const payments = [];
  let dataSpentUnits = 0n;

  async function getFree(why, path) {
    const url = `${config.suppliersBaseUrl}${path}`;
    const res = await fetch(url);
    if (res.status === 402) return { ok: false, reason: "this is a paid service; use a paid tool" };
    if (!res.ok) return { ok: false, reason: `service error (HTTP ${res.status})` };
    return { ok: true, data: await res.json() };
  }

  async function postFree(path, body) {
    const res = await fetch(`${config.suppliersBaseUrl}${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, data } : { ok: false, reason: data.error || `HTTP ${res.status}` };
  }

  // Shared by both kinds of purchase: ask, read the price, apply `decide`, then pay or refuse.
  async function purchase({ kind, why, path, method = "GET", decide, capUsd }) {
    const url = `${config.suppliersBaseUrl}${path}`;
    emit({ type: "step", kind, why, url });
    if (!signer) return refuse({ kind, why, url, priceUsd: 0 }, fail("wallet", "Korta's wallet key is missing: run npm run setup"));

    const first = await fetch(url, { method });
    if (first.status !== 402) {
      const data = await first.json().catch(() => ({}));
      if (!first.ok) {
        emit({ type: "error", url, message: data.error || `HTTP ${first.status}` });
        return { ok: false, reason: data.error || `service error (HTTP ${first.status})` };
      }
      return { ok: true, data };
    }

    const quote = readQuote(first);
    if (!quote) return refuse({ kind, why, url, priceUsd: 0 }, fail("asset", "no offer in USDC on our network"));
    emit({ type: "quote", kind, url, priceUsd: quote.priceUsd, description: quote.description });

    const decision = commonChecks(url, quote, spentTodayUnits()) ?? (await decide(quote));
    if (!decision.ok) return refuse({ kind, why, url, priceUsd: quote.priceUsd }, decision);

    emit({ type: "paying", kind, url, priceUsd: quote.priceUsd, reason: decision.reason });
    try {
      const res = await payingFetch(quote.units, capUsd)(url, { method });
      const header = res.headers.get("PAYMENT-RESPONSE");
      const settlement = header ? decodePaymentResponseHeader(header) : null;
      if (!res.ok || !settlement?.success) throw new Error(`payment not confirmed (HTTP ${res.status})`);

      if (kind === "data") dataSpentUnits += quote.units;
      appendSpendLog({ date: today(), at: new Date().toISOString(), kind, why, url,
                       units: String(quote.units), priceUsd: quote.priceUsd, tx: settlement.transaction });
      const entry = { kind, why, url, priceUsd: quote.priceUsd, paid: true, payTo: quote.payTo,
                      tx: settlement.transaction, link: explorer.tx(settlement.transaction) };
      payments.push(entry);
      emit({ type: "paid", ...entry, dataSpentUsd: toUsd(dataSpentUnits) });
      return { ok: true, data: await res.json(), payment: entry };
    } catch (e) {
      // The x402 client's own safeguards (Layer 2) stopped it before signing: a refusal, not a crash.
      if (/filtered out by policies|rejected by spendControls|spend control/i.test(e.message))
        return refuse({ kind, why, url, priceUsd: quote.priceUsd }, fail("client safeguard", "the price was above what we approved, so nothing was signed"));
      // Failed while building the payment: nothing was signed or sent.
      if (/insufficient balance/i.test(e.message))
        return refuse({ kind, why, url, priceUsd: quote.priceUsd }, fail("wallet balance", `Korta's wallet doesn't hold enough USDC (top up: ${usdc.faucetUrl})`));
      const beforeSigning = /Failed to create payment payload/i.test(e.message);
      payments.push({ kind, why, url, priceUsd: quote.priceUsd, paid: false, reason: e.message });
      emit({ type: "error", url, message: e.message,
             hint: beforeSigning ? "Nothing was signed or sent." : "Check the explorer: a settlement can land even when the server reports a failure." });
      return { ok: false, reason: e.message };
    }
  }

  function refuse({ kind, why, url, priceUsd }, decision) {
    payments.push({ kind, why, url, priceUsd, paid: false, reason: decision.reason });
    emit({ type: "refused", kind, url, priceUsd, rule: decision.rule, reason: decision.reason });
    return { ok: false, refused: true, rule: decision.rule, reason: `${decision.rule}: ${decision.reason}` };
  }

  // Quotes and demand signals: small, automatic, within the data limits.
  const buyData = (why, path) => purchase({
    kind: "data", why, path, capUsd: policy.dataMaxPerRequestUsd,
    decide: async (quote) => {
      if (quote.units > toUnits(policy.dataMaxPerRequestUsd)) return fail("price cap", `$${quote.priceUsd} is over the per-request cap for data`);
      if (dataSpentUnits + quote.units > toUnits(policy.dataBudgetPerRunUsd)) return fail("data budget", "would go over this run's data budget");
      return pass(`$${quote.priceUsd} is within the data limits`);
    },
  });

  // A supplier invoice the owner already approved at `approvedUsd`.
  const payInvoice = (why, path, approvedUsd) => purchase({
    kind: "order", why, path, method: "POST", capUsd: policy.orderMaxUsd,
    decide: async (quote) => {
      if (quote.units > toUnits(approvedUsd))
        return fail("price changed", `the invoice is $${quote.priceUsd} but the owner approved $${approvedUsd}`);
      if (quote.units > toUnits(policy.orderMaxUsd)) return fail("order cap", `$${quote.priceUsd} is over the per-order limit`);
      const after = (await walletUsdc()) - quote.priceUsd;
      if (after < policy.cashReserveUsd) return fail("cash reserve", "paying would take the wallet below the owner's cash reserve");
      return pass(`approved by the owner; $${quote.priceUsd} is within the order limits`);
    },
  });

  return { getFree, postFree, buyData, payInvoice, balance: walletUsdc, payments, dataSpentUsd: () => toUsd(dataSpentUnits) };
}
