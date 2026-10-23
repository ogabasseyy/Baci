import type { WebStoreReadiness } from '@baci/shared';
import { getWebStoreReadinessHref } from '@/components/dashboard/store-readiness-hrefs';

export interface OnboardingReminder {
  id: string;
  title: string;
  action: string;
  description: string;
  href: string;
}

/** A live projection, so completed tasks never accumulate as stale alerts. */
export function getOnboardingReminder(
  readiness: WebStoreReadiness
): OnboardingReminder | null {
  if (readiness.isPublished || !readiness.storeBuild.starterStoreReady)
    return null;
  const next = readiness.items.find(
    (item) => item.priority === 'required' && !item.completed
  );
  if (next) {
    return {
      id: next.id,
      title: 'Finish setting up your store',
      action: next.label,
      description: next.description,
      href: `${getWebStoreReadinessHref(next.id)}?onboarding=true`,
    };
  }
  if (!readiness.isReady) return null;
  return {
    id: 'publish_store',
    title: 'Your store is ready to launch',
    action: 'Preview and publish your store',
    description:
      'Your required setup steps are complete. Review your store before publishing.',
    href: '/dashboard',
  };
}
