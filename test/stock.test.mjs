import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { stockReport, packsNeeded, stockSummaryForAgent } from "../src/agent/stock.mjs";
import { checkBudget } from "../src/agent/budget.mjs";

const seed = JSON.parse(fs.readFileSync(new URL("../data/shop.seed.json", import.meta.url), "utf8"));
const byId = (report) => Object.fromEntries(report.items.map((i) => [i.id, i]));

test("seed: only rice and oil are at risk, at 3 days of cover", () => {
  const items = byId(stockReport(seed));
  assert.deepEqual(Object.values(items).filter((i) => i.atRisk).map((i) => i.id).sort(), ["oil", "rice"]);
  assert.equal(items.rice.daysOfCover, 3);
  assert.equal(items.oil.daysOfCover, 3);
  assert.equal(items.rice.dailyRate, 20);
});

test("seed: rice and oil sales are up this week", () => {
  const items = byId(stockReport(seed));
  assert.ok(items.rice.trendPct >= 20);
  assert.ok(items.oil.trendPct >= 20);
  assert.equal(items.sugar.trendPct, 0);
});

test("quantities: 3 bags + 2 cartons normally, 4 bags + 2 cartons with a 1.3× festive signal", () => {
  const normal = byId(stockReport(seed));
  assert.equal(normal.rice.suggestedPacks, 3);
  assert.equal(normal.oil.suggestedPacks, 2);
  const festive = byId(stockReport(seed, { staples: 1.3 }));
  assert.equal(festive.rice.suggestedPacks, 4);
  assert.equal(festive.oil.suggestedPacks, 2);
});

test("incoming stock counts toward cover", () => {
  const shop = structuredClone(seed);
  shop.items.find((i) => i.id === "rice").incoming = 200;
  assert.equal(byId(stockReport(shop)).rice.atRisk, false);
});

test("packsNeeded never orders when covered", () => {
  assert.equal(packsNeeded({ dailyRate: 1, stock: 100, packSize: 10 }, 10), 0);
});

test("agent summary flags unusual sales", () => {
  const s = stockSummaryForAgent(stockReport(seed));
  assert.equal(s.atRisk.length, 2);
  assert.match(s.note, /unusual/);
});

test("budget: per-order cap and cash reserve", () => {
  const policy = { orderMaxUsd: 8, cashReserveUsd: 2 };
  assert.equal(checkBudget({ totalUsd: 4.2, walletUsdc: 20, policy }).fits, true);
  assert.equal(checkBudget({ totalUsd: 9, walletUsdc: 20, policy }).fits, false);
  const reserve = checkBudget({ totalUsd: 4.2, walletUsdc: 5, policy });
  assert.equal(reserve.fits, false);
  assert.equal(reserve.shortfallUsd, 1.2);
});
