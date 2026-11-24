// The single source of configuration. Every value comes from .env (see .env.example).
// No silent defaults: if something is missing, we stop and say exactly what.
import "dotenv/config";
import { Keypair } from "@stellar/stellar-sdk";

const missing = [];
const invalid = [];
const required = (key) => {
  const value = process.env[key]?.trim();
  if (!value) missing.push(key);
  return value;
};
const optional = (key) => process.env[key]?.trim() || "";
const positiveNumber = (key) => {
  const value = Number(required(key));
  if (process.env[key] && !(value > 0)) invalid.push(`${key} (must be a positive number)`);
  return value;
};

const active = required("FACILITATOR");
if (active && !["primary", "backup"].includes(active)) invalid.push('FACILITATOR (must be "primary" or "backup")');
const F = active?.toUpperCase();

const brain = required("KORTA_BRAIN");
if (brain && !["ai", "scripted"].includes(brain)) invalid.push('KORTA_BRAIN (must be "ai" or "scripted")');

export const config = Object.freeze({
  network: required("STELLAR_NETWORK"),
  networkPassphrase: required("STELLAR_NETWORK_PASSPHRASE"),
  horizonUrl: required("STELLAR_HORIZON_URL"),
  rpcUrl: required("STELLAR_RPC_URL"),
  explorerUrl: required("STELLAR_EXPLORER_URL"),
  usdc: Object.freeze({
    code: required("USDC_ASSET_CODE"),
    issuer: required("USDC_ISSUER"),
    contractId: required("USDC_CONTRACT_ID"),
    decimals: Number(required("USDC_DECIMALS")),
    faucetUrl: required("USDC_FAUCET_URL"),
  }),
  // Each facilitator has its own URL + key, so a key is only ever sent to its own facilitator.
  facilitator: Object.freeze({
    name: active,
    url: F ? required(`FACILITATOR_${F}_URL`)?.replace(/\/+$/, "") : undefined,
    apiKey: F ? optional(`FACILITATOR_${F}_API_KEY`) : "",
    keyUrl: F ? optional(`FACILITATOR_${F}_KEY_URL`) : "",
  }),
  // Wallets are checked by the scripts that need them, with friendlier messages.
  agentSecret: optional("KORTA_AGENT_SECRET"),
  payees: Object.freeze({
    a: optional("SUPPLIER_A_ADDRESS"),
    b: optional("SUPPLIER_B_ADDRESS"),
    c: optional("SUPPLIER_C_ADDRESS"),
    market: optional("MARKET_ADDRESS"),
  }),
  port: Number(required("PORT")),
  suppliersBaseUrl: required("SUPPLIERS_BASE_URL")?.replace(/\/+$/, ""),
  consolePort: Number(required("CONSOLE_PORT")),
  demoControls: optional("KORTA_DEMO_CONTROLS") === "true",
  // Public deployments: approving an order needs this PIN. Empty = no PIN (local use).
  ownerPin: optional("KORTA_OWNER_PIN"),
  // The owner's policy. Enforced by the wallet in code; the AI is never told these numbers.
  policy: Object.freeze({
    allowedHosts: (required("KORTA_ALLOWED_HOSTS") || "").split(",").map((h) => h.trim()).filter(Boolean),
    dataMaxPerRequestUsd: positiveNumber("KORTA_DATA_MAX_PER_REQUEST_USD"),
    dataBudgetPerRunUsd: positiveNumber("KORTA_DATA_BUDGET_PER_RUN_USD"),
    orderMaxUsd: positiveNumber("KORTA_ORDER_MAX_USD"),
    cashReserveUsd: positiveNumber("KORTA_CASH_RESERVE_USD"),
    dailyBudgetUsd: positiveNumber("KORTA_DAILY_BUDGET_USD"),
    approvalTimeoutSeconds: positiveNumber("KORTA_APPROVAL_TIMEOUT_SECONDS"),
    spendLogFile: required("KORTA_SPEND_LOG_FILE"),
  }),
  ai: Object.freeze({
    brain,
    maxSteps: positiveNumber("KORTA_MAX_STEPS"),
    // Only required when the AI brain is on, so "scripted" works without a key.
    apiKey: optional("OPENAI_API_KEY"),
    model: optional("OPENAI_MODEL"),
  }),
});

if (missing.length) {
  console.error(`Missing in .env: ${missing.join(", ")}`);
  console.error("→ Run npm run setup to fill them in from .env.example.");
}
if (invalid.length) {
  console.error(`Invalid in .env: ${invalid.join(", ")}`);
  console.error("→ Fix these values in .env.");
}
if (missing.length || invalid.length) process.exit(1);

export const aiAvailable = () => Boolean(config.ai.apiKey && config.ai.model);

export function agentPublicKey() {
  try { return Keypair.fromSecret(config.agentSecret).publicKey(); }
  catch { return null; }
}

export const explorer = {
  account: (g) => `${config.explorerUrl}/account/${g}`,
  tx: (hash) => `${config.explorerUrl}/tx/${hash}`,
};

// USDC money math in whole units (7 decimals on Stellar), so 0.1 + 0.2 never bites.
export const toUnits = (usd) => BigInt(Math.round(usd * 10 ** config.usdc.decimals));
export const toUsd = (units) => Number(units) / 10 ** config.usdc.decimals;
export const usd = (n) => Math.round(n * 1e7) / 1e7;
