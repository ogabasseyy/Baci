import type { ReactNode } from 'react';
import { JsonLd } from '@/components/seo/json-ld';
import { resolveExperienceBoundary } from '@/lib/experience/route-data-revision';
import { getExperienceStorefrontRuntime } from '@/lib/experience/storefront-runtime';
import { ExperienceEngineFallback } from './ExperienceEngineFallback';
import { ExperienceRouteBoundary } from './ExperienceRouteBoundary';
import { ExperienceSemanticFallback } from './ExperienceSemanticFallback';
export async function ExperienceServerBoundary({
  merchant,
  path,
  fallback,
}: {
  merchant: { id: string; slug?: string | null };
  path: string;
  fallback: ReactNode;
}) {
  if (!getExperienceStorefrontRuntime()) return fallback;
  const data = await resolveExperienceBoundary(merchant, path);
  if (!data) return fallback;
  const snapshot = await getExperienceStorefrontRuntime()?.snapshot?.(
    merchant,
    data
  );
  const product =
    data.bootstrap.route.routeId === 'product'
      ? data.bootstrap.catalog.products.find((p) => p.canonicalPath === path)
      : undefined;
  return (
    <>
      {product && (
        <JsonLd
          data={{
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: product.name,
            url: data.canonicalUrl,
            offers: {
              '@type': 'Offer',
              price: product.price,
              priceCurrency: product.currency,
              availability:
                product.available === false
                  ? 'https://schema.org/OutOfStock'
                  : 'https://schema.org/InStock',
            },
          }}
        />
      )}
      <ExperienceRouteBoundary
        data={data}
        fallback={
          <>
            {snapshot && (
              <ExperienceSemanticFallback
                snapshot={{
                  revision: snapshot.key.catalog ?? 'non-catalog',
                  path: snapshot.key.path,
                  nodes: snapshot.nodes,
                }}
                currentRevision={data.bootstrap.catalog.revision}
                canonicalBase={data.launch.canonicalBase}
              />
            )}
            <ExperienceEngineFallback
              bootstrap={data.bootstrap}
              title={data.title}
              merchantId={merchant.id}
              canonicalBase={data.launch.canonicalBase}
            />
          </>
        }
      />
    </>
  );
}
