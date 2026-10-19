import type { Metadata } from 'next';
import { PLATFORM_CONFIG } from '@/config/platform';

const HOMEPAGE_TITLE =
  'Baci - AI E-commerce Store Builder for African Merchants';

export const metadata: Metadata = {
  title: HOMEPAGE_TITLE,
  description: PLATFORM_CONFIG.description,
  alternates: {
    canonical: PLATFORM_CONFIG.url,
  },
  openGraph: {
    title: HOMEPAGE_TITLE,
    description: PLATFORM_CONFIG.description,
    url: PLATFORM_CONFIG.url,
    siteName: PLATFORM_CONFIG.name,
    type: 'website',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: `Baci - ${PLATFORM_CONFIG.description}`,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: HOMEPAGE_TITLE,
    description: PLATFORM_CONFIG.description,
    images: ['/opengraph-image'],
  },
};

import { getLandingMetrics } from './actions';
import LandingPageRoute from './landing-page-route';

export default async function HomePage() {
  const metrics = await getLandingMetrics();
  return <LandingPageRoute metrics={metrics} />;
}
