import 'server-only';

import type { ImeiServiceTierKey } from '@baci/shared/imei';
import type {
  ImeiProviderBinding,
  ResolveImeiProviderBindingInput,
} from './types';

const PETROCK_TIER_BINDINGS: Partial<
  Record<ImeiServiceTierKey, ImeiProviderBinding>
> = {
  // 1955 rejected the paid blacklist probe. Keep blacklist on Sickw even
  // when allowlisted; a catalog annotation alone does not block submissions.
  knoxGuard: {
    costUsd: 0.09,
    deviceCategories: ['smartphone'],
    orderFieldName: 'IMEI/Serial No',
    productId: '699',
    provider: 'petrock',
  },
  pixel: {
    costUsd: 0.09,
    deviceCategories: ['smartphone'],
    orderFieldName: 'IMEI',
    productId: '721',
    provider: 'petrock',
  },
  samsung: {
    costUsd: 0.08,
    deviceCategories: ['smartphone'],
    orderFieldName: 'IMEI',
    productId: '741',
    provider: 'petrock',
  },
  // Product 693 is no longer listed. Product 716 is the current IMEI-only SIM-lock check.
  simLock: {
    costUsd: 0.06,
    deviceCategories: ['smartphone'],
    orderFieldName: 'IMEI',
    productId: '716',
    provider: 'petrock',
  },
};

function sickwBinding({ tier }: ResolveImeiProviderBindingInput) {
  return {
    costUsd: tier.costUsd,
    deviceCategories: tier.deviceCategories,
    orderFieldName: 'imei',
    productId: tier.providerServiceId,
    provider: 'sickw',
  } satisfies ImeiProviderBinding;
}

export function resolveImeiProviderBinding(
  input: ResolveImeiProviderBindingInput
): ImeiProviderBinding | null {
  const petrockOnly = input.tier.providerServiceId === 'petrock-only';
  if (
    !input.petrockEnabled ||
    !input.clientSupportsAsync ||
    !input.petrockEnabledTiers.has(input.tierKey)
  ) {
    return petrockOnly ? null : sickwBinding(input);
  }

  const binding = PETROCK_TIER_BINDINGS[input.tierKey];
  if (!binding) {
    return petrockOnly ? null : sickwBinding(input);
  }

  if (
    (input.tier.deviceCategories.length > 1 && !input.deviceCategory) ||
    (input.deviceCategory &&
      !binding.deviceCategories.includes(input.deviceCategory))
  ) {
    return petrockOnly ? null : sickwBinding(input);
  }

  return binding;
}
