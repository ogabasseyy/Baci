import { ImeiCheckerHero } from '@/components/storefront/ogabassey/pages/imei-checker-hero';
import { isOgabasseyStaticTenant } from '../../ogabassey-static-params';

/**
 * Committed IMEI LCP hero. Awaits `params` only so other merchants never
 * see OgaBassey trust copy before `ImeiCheckResolvedContent` 404s.
 */
export async function ImeiCheckCommittedHero({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isOgabasseyStaticTenant(slug)) {
    return null;
  }

  return <ImeiCheckerHero />;
}
