import { getAllBusinessTypes } from '@/config/business-types';
import type { BusinessTypeBreakdown } from '@/types/analytics';

export interface AdminBusinessTypeCount {
  businessType: string | null;
  merchants: number;
}

const BUSINESS_TYPE_LABELS = new Map(
  getAllBusinessTypes().map((businessType) => [
    businessType.id,
    businessType.label,
  ])
);

function getShare(count: number, total: number): number {
  return total > 0 ? (count / total) * 100 : 0;
}

export function buildAdminBusinessTypeBreakdowns(
  counts: AdminBusinessTypeCount[],
  totalMerchants: number
): BusinessTypeBreakdown[] {
  const configuredCounts = new Map<string, number>();
  const invalidValues = new Set<string>();
  let invalidCount = 0;
  let unspecifiedCount = 0;

  for (const count of counts) {
    const rawValue = count.businessType?.trim();
    const normalizedValue = rawValue?.toLowerCase();

    if (!normalizedValue) {
      unspecifiedCount += count.merchants;
      continue;
    }

    if (BUSINESS_TYPE_LABELS.has(normalizedValue)) {
      configuredCounts.set(
        normalizedValue,
        (configuredCounts.get(normalizedValue) ?? 0) + count.merchants
      );
      continue;
    }

    invalidCount += count.merchants;
    invalidValues.add(rawValue ?? normalizedValue);
  }

  const breakdowns: BusinessTypeBreakdown[] = Array.from(
    configuredCounts.entries()
  ).flatMap(([businessType, merchants]) => {
    const label = BUSINESS_TYPE_LABELS.get(businessType);
    return label
      ? [
          {
            businessType,
            classification: 'configured' as const,
            label,
            merchants,
            rawValues: [],
            shareOfMerchants: getShare(merchants, totalMerchants),
          },
        ]
      : [];
  });

  if (unspecifiedCount > 0) {
    breakdowns.push({
      businessType: 'unspecified',
      classification: 'unspecified',
      label: 'Unspecified',
      merchants: unspecifiedCount,
      rawValues: [],
      shareOfMerchants: getShare(unspecifiedCount, totalMerchants),
    });
  }

  if (invalidCount > 0) {
    breakdowns.push({
      businessType: 'invalid',
      classification: 'invalid',
      label: 'Invalid / Legacy Values',
      merchants: invalidCount,
      rawValues: Array.from(invalidValues).sort((left, right) =>
        left.localeCompare(right)
      ),
      shareOfMerchants: getShare(invalidCount, totalMerchants),
    });
  }

  return breakdowns.sort((left, right) => {
    if (right.merchants !== left.merchants) {
      return right.merchants - left.merchants;
    }
    if (left.classification !== right.classification) {
      return left.classification.localeCompare(right.classification);
    }
    return left.label.localeCompare(right.label);
  });
}
