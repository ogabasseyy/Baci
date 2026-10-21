'use client';

import {
  formatCanonicalProductConditionLabel,
  sortCanonicalProductConditionsByPreference,
} from '@baci/shared/lib';
import { useOptionalOgabasseyPdpCriticalCommerce } from './critical-commerce-state.client';
import { getVariantAxisOptions } from './critical-variant-selector-options';

function formatCriticalCondition(condition: string | null | undefined) {
  return formatCanonicalProductConditionLabel(condition) || null;
}

function getCriticalMixedConditionLabel(conditions: string[]) {
  const sortedConditions =
    sortCanonicalProductConditionsByPreference(conditions);

  if (sortedConditions.length <= 1) {
    return null;
  }

  return sortedConditions.length === 2 &&
    sortedConditions.includes('new') &&
    sortedConditions.includes('used')
    ? 'New & Used'
    : 'Multiple Conditions';
}

export function OgabasseyPdpCriticalConditionBadge({
  fallbackCondition,
}: {
  fallbackCondition?: string | null;
}) {
  const commerceState = useOptionalOgabasseyPdpCriticalCommerce();
  const conditionOptions = commerceState
    ? getVariantAxisOptions(
        commerceState.variants,
        'condition',
        commerceState.variantAxisOptions
      )
    : [];
  const condition =
    getCriticalMixedConditionLabel(conditionOptions) ||
    formatCriticalCondition(
      commerceState?.productForCart.condition ?? fallbackCondition
    );

  if (!condition) {
    return null;
  }

  return <span data-ogabassey-pdp-condition>{condition}</span>;
}

export function OgabasseyPdpCriticalCommerceConditionFact({
  fallbackCondition,
}: {
  fallbackCondition?: string | null;
}) {
  const commerceState = useOptionalOgabasseyPdpCriticalCommerce();
  const condition = formatCriticalCondition(
    commerceState?.productForCart.condition ?? fallbackCondition
  );

  if (!condition) {
    return null;
  }

  return (
    <p data-ogabassey-pdp-commerce-fact>
      <span>Condition</span>
      <strong>{condition}</strong>
    </p>
  );
}
