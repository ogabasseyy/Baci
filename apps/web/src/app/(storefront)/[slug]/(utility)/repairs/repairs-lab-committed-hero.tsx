import { RepairsLabHero } from '@/components/storefront/ogabassey/pages/repairs-lab-hero';
import { isDomainIdentifier } from '@/lib/validation';
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

  const basePath = isDomainIdentifier(slug) ? '' : `/${slug}`;

  return (
    <div className="min-h-screen bg-store-secondary pb-24 pt-4 text-store-background-text md:pb-12 md:pt-8">
      <div className="mx-auto w-full max-w-[1400px] px-4 md:px-6">
        <RepairsLabHero
          repairHref={`${basePath}/repair`}
          swapHref={`${basePath}/swap`}
        />
      </div>
    </div>
  );
}
