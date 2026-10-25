import type { JumiaCreateProduct } from '@/schemas/jumia/create-product';

export type JumiaPreparedFamilyRecord = {
  familyKey: string;
  businessClientCode: string;
  categoryCode: number;
  attributeSetId: string;
  record: JumiaCreateProduct;
};

export type JumiaPackedFeed = {
  businessClientCode: string;
  categoryCode: number;
  attributeSetId: string;
  records: JumiaCreateProduct[];
};

export type JumiaFamilyPackingResult =
  | {
      success: false;
      errors: (
        | { code: 'family_exceeds_feed_limit'; familyKey: string }
        | { code: 'duplicate_seller_sku'; sellerSku: string }
        | { code: 'family_group_mismatch'; familyKey: string }
      )[];
    }
  | { success: true; feeds: JumiaPackedFeed[] };

/** Packs complete canonical families without splitting or reordering their records. */
export function packJumiaProductFamilies(
  products: readonly JumiaPreparedFamilyRecord[],
  maximumRecordsPerFeed = 1000
): JumiaFamilyPackingResult {
  if (!Number.isInteger(maximumRecordsPerFeed) || maximumRecordsPerFeed < 1)
    return { success: false, errors: [] };

  const families = new Map<string, JumiaPreparedFamilyRecord[]>();
  for (const item of products) {
    const group = families.get(item.familyKey) ?? [];
    group.push(item);
    families.set(item.familyKey, group);
  }
  const ordered = [...families.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  const errors: Extract<
    JumiaFamilyPackingResult,
    { success: false }
  >['errors'] = [];
  const sellerSkus = new Set<string>();
  for (const [, family] of ordered) {
    const first = family[0];
    if (
      family.some(
        (item) =>
          item.businessClientCode !== first.businessClientCode ||
          item.categoryCode !== first.categoryCode ||
          item.attributeSetId !== first.attributeSetId
      )
    )
      errors.push({
        code: 'family_group_mismatch',
        familyKey: family[0].familyKey,
      });
    for (const item of family) {
      if (sellerSkus.has(item.record.sellerSku))
        errors.push({
          code: 'duplicate_seller_sku',
          sellerSku: item.record.sellerSku,
        });
      sellerSkus.add(item.record.sellerSku);
    }
  }
  errors.push(
    ...ordered
      .filter(([, family]) => family.length > maximumRecordsPerFeed)
      .map(([familyKey]) => ({
        code: 'family_exceeds_feed_limit' as const,
        familyKey,
      }))
  );
  if (errors.length) return { success: false, errors };

  const feeds: JumiaPackedFeed[] = [];
  let current: JumiaPackedFeed | undefined;
  for (const [, family] of ordered) {
    const first = family[0];
    let target = current;
    if (
      !target ||
      target.businessClientCode !== first.businessClientCode ||
      target.categoryCode !== first.categoryCode ||
      target.attributeSetId !== first.attributeSetId ||
      target.records.length + family.length > maximumRecordsPerFeed
    ) {
      target = {
        businessClientCode: first.businessClientCode,
        categoryCode: first.categoryCode,
        attributeSetId: first.attributeSetId,
        records: [],
      };
      current = target;
      feeds.push(target);
    }
    target.records.push(...family.map(({ record }) => structuredClone(record)));
  }
  return { success: true, feeds };
}
