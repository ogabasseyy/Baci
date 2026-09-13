import { OgabasseyHomeCriticalShell } from '@/app/(storefront)/ogabassey/ogabassey-home-critical-shell';
import { isOgabasseyHomeIdentifier } from './is-ogabassey-home-identifier';

/**
 * Early critical styles and accessible document heading, without a second
 * visible banner. The request-scoped publication owner renders the real hero.
 *
 * Awaits `params` only. Do not read request APIs or `'use cache'` listing data.
 */
export async function OgabasseyHomeCommittedLcp({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isOgabasseyHomeIdentifier(slug)) {
    return null;
  }

  return (
    <div data-ogabassey-home-lcp-shell="true">
      <OgabasseyHomeCriticalShell />
    </div>
  );
}
