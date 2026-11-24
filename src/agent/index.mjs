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
  const { summary } = await run(task, toolbox, emit);

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
