import { getWebStoreReadinessHref } from '@/components/dashboard/store-readiness-hrefs';
import {
  buildStoreLaunchReadiness,
  type StoreLaunchFacts,
} from '@/lib/store-readiness/build-store-launch-readiness';

export type OnboardingStage = 'welcome' | 'day1' | 'day3' | 'day5' | 'day7';
export type OnboardingDecision =
  | { kind: 'send'; action: string; href: string }
  | { kind: 'skip' | 'defer' };
export interface OnboardingContext {
  confirmed: boolean;
  enabled: boolean;
  deliveryEnabled: boolean;
  isPublished: boolean;
  provisioned: boolean;
  facts: StoreLaunchFacts;
}
export function decideOnboardingEmail(
  stage: OnboardingStage,
  context: OnboardingContext
): OnboardingDecision {
  if (!context.enabled || (stage !== 'welcome' && context.isPublished))
    return { kind: 'skip' };
  if (!context.deliveryEnabled || !context.confirmed || !context.provisioned)
    return { kind: 'defer' };
  const readiness = buildStoreLaunchReadiness(context.facts);
  const next = readiness.items.find(
    (item) => item.priority === 'required' && !item.completed
  );
  if (stage === 'day1' && context.facts.activeProductCount > 0)
    return { kind: 'skip' };
  if (stage === 'day3' && !next) return { kind: 'skip' };
  if (stage === 'day5' && !readiness.isReady) return { kind: 'skip' };
  if (stage === 'day7')
    return {
      kind: 'send',
      action: 'Get help finishing your setup',
      href: '/dashboard',
    };
  if (stage === 'day1')
    return {
      kind: 'send',
      action: 'Publish your first product',
      href: '/dashboard/products',
    };
  if (next)
    return {
      kind: 'send',
      action: next.label,
      href: getWebStoreReadinessHref(next.id),
    };
  return {
    kind: 'send',
    action: context.isPublished
      ? 'Open your dashboard'
      : 'Preview and publish your store',
    href: '/dashboard',
  };
}
