// Run Korta in the terminal:  npm run restock [-- --brain ai|scripted] [-- --approve | --decline]
// Without --approve/--decline it asks you y/N before ordering (no terminal → declined).
import readline from "node:readline/promises";
import { runRestock } from "./index.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

async function askInTerminal(rec) {
  if (flag("approve")) { console.log("   (auto-approved with --approve)"); return true; }
  if (flag("decline") || !process.stdin.isTTY) { console.log("   (declined)"); return false; }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const closed = new Promise((resolve) => rl.once("close", () => resolve("")));
  const answer = await Promise.race([rl.question(`   ? Approve paying ${rec.totalUsd} USDC to ${rec.supplier}? [y/N] `), closed]);
  rl.close();
  return /^y(es)?$/i.test(String(answer).trim());
}

const money = (n) => `$${Number(n).toFixed(3).replace(/0$/, "")}`;
function print(e) {
  const line = {
    start: () => `\nKorta · ${e.shop.name} · brain: ${e.brain === "ai" ? `AI (${e.model})` : "scripted"}\nWallet ${e.wallet?.slice(0, 6)}… holds ${e.walletUsdc} USDC (hard limit) · spent today ${money(e.todayUsd)}\n`,
    notice: () => `! ${e.text}`,
    thought: () => `  Korta: ${e.text}`,
    tool: () => `→ ${e.name}${Object.keys(e.args || {}).length ? ` ${JSON.stringify(e.args).slice(0, 140)}` : ""}`,
    stock: () => `   at risk: ${e.report.items.filter((i) => i.atRisk).map((i) => `${i.name} (${i.daysOfCover} days, order ${i.suggestedPacks} × ${i.pack})`).join(", ") || "nothing"} · ${e.note}`,
    quote: () => `   402: costs ${money(e.priceUsd)}`,
    paid: () => `   ✓ paid ${money(e.priceUsd)} · ${e.link}`,
    refused: () => `   ✗ refused (${e.rule}: ${e.reason})`,
    offer: () => `   ${e.quote.supplier}: ${e.quote.totalUsd} USDC, delivers in ${e.quote.deliveryDays} day(s)${e.quote.allInStock ? "" : " · missing items"}`,
    recommendation: () => {
      const r = e.recommendation;
      return `\n  RECOMMENDATION: ${r.lines.map((l) => `${l.packs} × ${l.pack} ${l.name}`).join(" + ")} from ${r.supplier} = ${r.totalUsd} USDC\n  ${r.reason}\n  Wallet after: ${r.walletAfterUsd} USDC`;
    },
    unpaid: () => `   ✗ not paid: ${e.reason}`,
    records: () => `   ✓ records updated: order ${e.order.orderId}, delivery ${e.order.deliveryDate}`,
    error: () => `   ✗ ${e.message}${e.hint ? `\n     ${e.hint}` : ""}`,
    done: () => `\nAnswer: ${e.summary}\nData spent ${money(e.dataSpentUsd)} · ${e.payments.filter((p) => p.paid).length} paid, ${e.payments.filter((p) => !p.paid).length} refused/failed · wallet now ${e.walletUsdc} USDC\n`,
  }[e.type];
  if (line) console.log(line());
}

const task = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--brain").join(" ") || undefined;
await runRestock({ task, emit: print, approve: askInTerminal, brain: value("brain") });
