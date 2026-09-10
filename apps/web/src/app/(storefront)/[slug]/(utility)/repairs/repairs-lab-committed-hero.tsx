import { RepairsLabHero } from '@/components/storefront/ogabassey/pages/repairs-lab-hero';
import { isOgabasseyStaticTenant } from '../../ogabassey-static-params';

/**
 * Committed repairs LCP hero. Awaits `params` only so other merchants never
 * see OgaBassey lab claims before tenant resolution.
 */
export async function RepairsLabCommittedHero({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isOgabasseyStaticTenant(slug)) {
    return null;
  }

  return <RepairsLabHero />;
}
