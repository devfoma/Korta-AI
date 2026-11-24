// Budget check: pure function, no AI. The wallet enforces the same limits again at payment
// time, so this is advice for the agent, not the safety net.
const r2 = (n) => Math.round(n * 100) / 100;

export function checkBudget({ totalUsd, walletUsdc, policy }) {
  const after = walletUsdc - totalUsd;
  if (totalUsd > policy.orderMaxUsd)
    return { fits: false, reason: `${r2(totalUsd)} USDC is above the owner's per-order limit.`, shortfallUsd: r2(totalUsd - policy.orderMaxUsd) };
  if (after < policy.cashReserveUsd)
    return { fits: false, reason: `Paying ${r2(totalUsd)} USDC would take the wallet below the owner's cash reserve.`, shortfallUsd: r2(policy.cashReserveUsd - after) };
  return { fits: true, reason: `Fits: the wallet keeps ${r2(after)} USDC after this order.`, walletAfterUsd: r2(after) };
}
