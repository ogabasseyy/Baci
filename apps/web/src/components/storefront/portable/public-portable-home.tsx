'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api-client';
import { createPortablePublishedSnapshot } from '@/lib/portable-published-snapshot';
import {
  type PortableCatalog,
  portableCatalogSchema,
  portableHomeSchema,
  portableIdentitySchema,
} from '@/schemas/portable-storefront';
import { PublicationRevisionMarker } from '../publication-revision-marker';
import { PortableHomeView } from './portable-home';

/** The same published-catalog API already used by the legacy public ProductGrid. */
export async function loadPortablePublicCatalog(
  merchantId: string
): Promise<PortableCatalog> {
  const query = new URLSearchParams({
    merchant_id: merchantId,
    compact: 'true',
    limit: '24',
    sort: 'newest',
  });
  const response = await apiGet<{
    products: {
      id: string;
      name: string;
      price: number;
      image?: string;
      slug: string;
      status: string;
    }[];
  }>(`/api/storefront/products?${query}`, { cache: 'no-store' });
  return portableCatalogSchema.parse({
    merchantId,
    capturedAt: new Date().toISOString(),
    products: response.products
      .filter((product) => product.status === 'active')
      .map((product) => ({
        id: product.id,
        merchant_id: merchantId,
        name: product.name,
        price: product.price,
        image: product.image || null,
        slug: product.slug,
      })),
  });
}

export function PublicPortableHome({
  config,
  merchant,
  basePath,
  publishedVersion,
}: {
  config: unknown;
  merchant: unknown;
  basePath: string;
  publishedVersion?: string | null;
}) {
  const identity = portableIdentitySchema.safeParse(merchant);
  const merchantId = identity.success ? identity.data.id : null;
  const [snapshot, setSnapshot] = useState<{
    published: Awaited<ReturnType<typeof createPortablePublishedSnapshot>>;
    catalog: PortableCatalog;
    sourceConfig: unknown;
    sourcePublishedVersion: string | null | undefined;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setSnapshot(null);
    setFailed(false);
    if (merchantId && portableHomeSchema.safeParse(config).success) {
      Promise.all([
        createPortablePublishedSnapshot(config),
        loadPortablePublicCatalog(merchantId),
      ])
        .then(([published, catalog]) => {
          if (active)
            setSnapshot({
              published,
              catalog,
              sourceConfig: config,
              sourcePublishedVersion: publishedVersion,
            });
        })
        .catch(() => {
          if (active) setFailed(true);
        });
    } else setFailed(true);
    return () => {
      active = false;
    };
  }, [merchantId, config, publishedVersion]);
  if (failed)
    return (
      <div role="alert">
        Homepage unavailable. Open Baci to review this homepage.
      </div>
    );
  if (
    !snapshot ||
    snapshot.catalog.merchantId !== merchantId ||
    snapshot.sourceConfig !== config ||
    snapshot.sourcePublishedVersion !== publishedVersion
  )
    return <div role="status">Loading catalog</div>;
  return (
    <PublicationRevisionMarker
      version={snapshot.sourcePublishedVersion}
      contentDigest={snapshot.published.publishedVersion}
    >
      <PortableHomeView
        config={snapshot.published.config}
        merchant={merchant}
        catalog={snapshot.catalog}
        inert={false}
        basePath={basePath}
      />
    </PublicationRevisionMarker>
  );
}
