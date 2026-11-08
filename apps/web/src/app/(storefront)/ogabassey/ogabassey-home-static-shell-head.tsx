import { Suspense } from 'react';
import { JsonLd } from '@/components/seo/json-ld';
import {
  OGABASSEY_DESCRIPTION,
  OGABASSEY_HOME_URL,
  OGABASSEY_SOCIAL_IMAGE_URL,
  OGABASSEY_TITLE,
} from '@/config/ogabassey';
import { buildStorefrontEntityId } from '@/lib/storefront-entity-id';
import { OgabasseyHomeStyleLoader } from './ogabassey-home-style-loader';

export const ogabasseyStaticHomepageSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  '@id': buildStorefrontEntityId(OGABASSEY_HOME_URL, 'homepage'),
  name: OGABASSEY_TITLE,
  description: OGABASSEY_DESCRIPTION,
  url: OGABASSEY_HOME_URL,
  about: {
    '@id': buildStorefrontEntityId(OGABASSEY_HOME_URL, 'online-store'),
  },
  isPartOf: {
    '@type': 'WebSite',
    '@id': buildStorefrontEntityId(OGABASSEY_HOME_URL, 'website'),
    name: 'OgaBassey',
    url: OGABASSEY_HOME_URL,
  },
  primaryImageOfPage: {
    '@type': 'ImageObject',
    url: OGABASSEY_SOCIAL_IMAGE_URL,
  },
} as const;

export function OgabasseyHomeStaticShellHead() {
  return (
    <Suspense fallback={null}>
      <JsonLd data={ogabasseyStaticHomepageSchema} />
      <OgabasseyHomeStyleLoader />
    </Suspense>
  );
}
