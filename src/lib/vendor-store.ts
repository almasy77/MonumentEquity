/**
 * Redis persistence for the Vendors directory. See src/lib/vendors.ts for the
 * key layout and types.
 */
import { getRedis, addToIndex, removeFromIndex } from "./db";
import { SEED_VENDORS, type Vendor, type DealVendor } from "./vendors";

const SEED_FLAG = "vendors:seeded:v1";

/**
 * Write the starter vendors exactly once. Guarded by a flag key (SET NX) so a
 * vendor the user deletes is not resurrected on the next page load.
 */
export async function ensureSeedVendors(): Promise<void> {
  const redis = getRedis();
  const claimed = await redis.set(SEED_FLAG, new Date().toISOString(), { nx: true });
  if (!claimed) return;
  const now = new Date().toISOString();
  let score = Date.now();
  for (const seed of SEED_VENDORS) {
    const id = crypto.randomUUID();
    const vendor: Vendor = { ...seed, id, created_at: now, updated_at: now };
    await redis.set(`vendor:${id}`, JSON.stringify(vendor));
    await addToIndex("vendors:all", id, score--);
  }
}

export async function listVendors(): Promise<Vendor[]> {
  const redis = getRedis();
  const ids = await redis.zrange<string[]>("vendors:all", 0, -1, { rev: true });
  if (ids.length === 0) return [];
  const pipeline = redis.pipeline();
  for (const id of ids) pipeline.get(`vendor:${id}`);
  const results = await pipeline.exec<(Vendor | null)[]>();
  return results.filter((v): v is Vendor => v !== null);
}

export async function getVendor(id: string): Promise<Vendor | null> {
  return getRedis().get<Vendor>(`vendor:${id}`);
}

export async function saveVendor(vendor: Vendor, isNew: boolean): Promise<void> {
  await getRedis().set(`vendor:${vendor.id}`, JSON.stringify(vendor));
  if (isNew) await addToIndex("vendors:all", vendor.id, Date.now());
}

export async function deleteVendor(id: string): Promise<void> {
  const redis = getRedis();
  const links = await listDealVendorsByVendor(id);
  for (const l of links) await deleteDealVendor(l);
  await redis.del(`vendor:${id}`);
  await removeFromIndex("vendors:all", id);
}

async function readDealVendors(indexKey: string): Promise<DealVendor[]> {
  const redis = getRedis();
  const ids = await redis.zrange<string[]>(indexKey, 0, -1, { rev: true });
  if (ids.length === 0) return [];
  const pipeline = redis.pipeline();
  for (const id of ids) pipeline.get(`deal_vendor:${id}`);
  const results = await pipeline.exec<(DealVendor | null)[]>();
  return results.filter((v): v is DealVendor => v !== null);
}

export const listDealVendorsByDeal = (dealId: string) => readDealVendors(`deal_vendors:by_deal:${dealId}`);
export const listDealVendorsByVendor = (vendorId: string) => readDealVendors(`deal_vendors:by_vendor:${vendorId}`);

export async function getDealVendor(id: string): Promise<DealVendor | null> {
  return getRedis().get<DealVendor>(`deal_vendor:${id}`);
}

export async function saveDealVendor(link: DealVendor, isNew: boolean): Promise<void> {
  await getRedis().set(`deal_vendor:${link.id}`, JSON.stringify(link));
  if (isNew) {
    const score = Date.now();
    await addToIndex(`deal_vendors:by_deal:${link.deal_id}`, link.id, score);
    await addToIndex(`deal_vendors:by_vendor:${link.vendor_id}`, link.id, score);
  }
}

export async function deleteDealVendor(link: DealVendor): Promise<void> {
  await getRedis().del(`deal_vendor:${link.id}`);
  await removeFromIndex(`deal_vendors:by_deal:${link.deal_id}`, link.id);
  await removeFromIndex(`deal_vendors:by_vendor:${link.vendor_id}`, link.id);
}
