import type { Metadata } from 'next';
import { Suspense } from 'react';
import { documentViewport } from '@/app/document-viewport';
import { RootDocumentStyle } from '@/app/root-document-style';
import { RootDynamicBody } from '@/app/root-dynamic-body';
import { Toaster } from '@/components/ui/toaster';
import { PLATFORM_CONFIG } from '@/config/platform';

export const metadata: Metadata = {
  metadataBase: new URL(PLATFORM_CONFIG.url),
  alternates: {
    canonical: './',
  },
  title: {
    default: `${PLATFORM_CONFIG.name} - ${PLATFORM_CONFIG.description}`,
    template: `%s | ${PLATFORM_CONFIG.name}`,
  },
  description: PLATFORM_CONFIG.description,
  applicationName: PLATFORM_CONFIG.name,
  authors: [{ name: PLATFORM_CONFIG.name }],
  keywords: [
    'ai',
    'ecommerce',
    'store builder',
    'online store',
    'nextjs',
    'react',
    'business',
    'retail',
  ],
  // Favicon configuration - comprehensive setup for all devices
  icons: {
    icon: [
      { url: '/baci-verified-favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  // PWA manifest
  manifest: '/manifest.json',
  // Google AdSense site-ownership verification (renders
  // <meta name="google-adsense-account" content="ca-pub-9332275663101466">).
  verification: {
    other: {
      'google-adsense-account': 'ca-pub-9332275663101466',
    },
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    title: `${PLATFORM_CONFIG.name} - ${PLATFORM_CONFIG.description}`,
    description: PLATFORM_CONFIG.description,
    url: PLATFORM_CONFIG.url,
    siteName: PLATFORM_CONFIG.name,
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: `${PLATFORM_CONFIG.name} - ${PLATFORM_CONFIG.description}`,
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${PLATFORM_CONFIG.name} - ${PLATFORM_CONFIG.description}`,
    description: PLATFORM_CONFIG.description,
    creator: '@usebaci',
    images: ['/opengraph-image'],
  },
};

export const viewport = documentViewport;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <body suppressHydrationWarning>
        <RootDocumentStyle />
        {/* Skip link for accessibility - allows keyboard users to bypass navigation */}
        <a href="#main-content" className="baci-skip-link">
          Skip to main content
        </a>
        <Toaster />
        <Suspense fallback={null}>
          <RootDynamicBody />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
