// One restock run: Korta's wallet + tools + a brain (AI or scripted).
// emit(event) reports every step (terminal and dashboard both use it).
// approve(recommendation) → true | false | "timeout". Defaults to "no": nothing is ordered without the owner.
import { config, aiAvailable } from "../config.mjs";
import { createWallet, walletAddress, walletUsdc, spentTodayUsd } from "../wallet/index.mjs";
import { createTools } from "./tools.mjs";
import { runAiBrain } from "./brain-ai.mjs";
import { runScriptedBrain } from "./brain-scripted.mjs";
import { loadShop } from "../store/shop.mjs";

export async function runRestock({ task, emit = () => {}, approve = async () => false, brain = config.ai.brain } = {}) {
  if (brain === "ai" && !aiAvailable()) {
    emit({ type: "notice", text: "AI brain needs OPENAI_API_KEY and OPENAI_MODEL in .env, so this run uses the scripted brain." });
    brain = "scripted";
  }
  const wallet = createWallet(emit);
  const toolbox = createTools({ wallet, emit, approve });
  const { shop } = loadShop();
  emit({
    type: "start", task, brain, model: brain === "ai" ? config.ai.model : null, shop,
    wallet: walletAddress(), walletUsdc: await walletUsdc(), todayUsd: spentTodayUsd(),
  });

  const run = brain === "ai" ? runAiBrain : runScriptedBrain;
  let { summary, aiFailed } = await run(task, toolbox, emit);
  // The AI didn't respond before anything was bought: finish the job with the scripted brain
  // (same tools, same rules). Once money has moved, stop instead, so nothing is bought twice.
  if (aiFailed && wallet.payments.length === 0 && !toolbox.state.decision) {
    emit({ type: "notice", text: "The AI model didn't respond, so Korta switched to the scripted brain (same tools, same rules)." });
    ({ summary } = await runScriptedBrain(task, toolbox, emit));
  }

  const result = {
    summary,
    decision: toolbox.state.decision,
    payments: wallet.payments,
    dataSpentUsd: wallet.dataSpentUsd(),
    walletUsdc: await walletUsdc(),
  };
  emit({ type: "done", ...result });
  return result;
}
