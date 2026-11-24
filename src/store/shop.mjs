// The shop's records: a JSON file, no database. data/shop.seed.json is committed;
// data/shop.json is the live copy (git-ignored) and is recreated from the seed on reset.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../data");
const SEED = path.join(DATA, "shop.seed.json");
const LIVE = process.env.KORTA_SHOP_FILE || path.join(DATA, "shop.json"); // tests point this at a temp file

export function loadShop() {
  if (!fs.existsSync(LIVE)) resetShop();
  return JSON.parse(fs.readFileSync(LIVE, "utf8"));
}

export function saveShop(shop) {
  fs.writeFileSync(LIVE, JSON.stringify(shop, null, 1));
}

export function resetShop() {
  if (!fs.existsSync(SEED)) throw new Error("data/shop.seed.json is missing. Run: npm run seed");
  fs.copyFileSync(SEED, LIVE);
}

// After the supplier invoice is paid: stock is on its way, the ledger and order history update.
export function recordPaidOrder({ supplier, order, lines, tx, link }) {
  const shop = loadShop();
  for (const line of lines) {
    const item = shop.items.find((i) => i.id === line.itemId);
    if (item) item.incoming = (item.incoming || 0) + line.packs * item.packSize;
  }
  const at = new Date().toISOString();
  shop.orders.push({ at, orderId: order.orderId, supplierId: supplier.id, supplier: supplier.name,
                     lines, totalUsd: order.totalUsd, deliveryDate: order.deliveryDate, status: "paid", tx, link });
  shop.ledger.push({ at, type: "supplier payment", amountUsd: -order.totalUsd, memo: `${supplier.name} · ${order.orderId}`, tx, link });
  saveShop(shop);
  return shop;
}

export function recordDataPurchase({ why, priceUsd, tx, link }) {
  const shop = loadShop();
  shop.ledger.push({ at: new Date().toISOString(), type: "data purchase", amountUsd: -priceUsd, memo: why, tx, link });
  saveShop(shop);
}
