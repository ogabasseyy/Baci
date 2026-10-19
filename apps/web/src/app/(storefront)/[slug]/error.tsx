'use client';

import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { ChunkRecoveryNotice } from '@/components/system/chunk-recovery-notice';
import { useMerchantSafe } from '@/hooks/merchant/use-merchant';
import { useBoundaryErrorReport } from '@/hooks/use-boundary-error-report';
import { asRoute } from '@/lib/routes';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

const PRIMARY_ACTION_CLASS_NAME =
  'inline-flex h-12 min-w-[48px] w-full items-center justify-center gap-2 whitespace-nowrap rounded-md bg-store-primary px-8 text-sm font-medium text-store-primary-text ring-offset-background transition-colors hover:bg-store-primary/90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 cursor-pointer touch-manipulation sm:w-auto';

const OUTLINE_ACTION_CLASS_NAME =
  'inline-flex h-12 min-w-[48px] w-full items-center justify-center gap-2 whitespace-nowrap rounded-md border border-store-accent bg-transparent px-8 text-sm font-medium text-store-accent ring-offset-background transition-colors hover:bg-store-accent/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 cursor-pointer touch-manipulation sm:w-auto';

export default function StorefrontError({ error, reset }: ErrorProps) {
  const merchantContext = useMerchantSafe();
  const basePath = merchantContext?.basePath;

  const recovering = useBoundaryErrorReport(error, {
    routeSurface: 'storefront',
    logLabel: 'Storefront error',
    properties: { storefront_base_path: basePath },
  });

  if (recovering) {
    return <ChunkRecoveryNotice />;
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-8">
      <div className="text-center space-y-6 max-w-lg">
        {/* Error icon */}
        <div className="mx-auto size-20 rounded-full bg-destructive/10 flex items-center justify-center">
          <AlertTriangle className="size-10 text-destructive" />
        </div>

        <h1
          className="text-3xl md:text-4xl font-bold"
          style={{ color: 'var(--store-primary, #1F2937)' }}
        >
          Something Went Wrong
        </h1>

        <p className="text-muted-foreground text-lg">
          We encountered an unexpected error while loading this page. Please try
          again or return to the homepage.
        </p>

        {/* Error details for development */}
        {process.env.NODE_ENV === 'development' && (
          <details className="text-left bg-muted/50 rounded-lg p-4 text-sm">
            <summary className="cursor-pointer font-medium text-muted-foreground">
              Error Details (Development Only)
            </summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-destructive">
              {error.message}
            </pre>
            {error.digest && (
              <p className="mt-2 text-xs text-muted-foreground">
                Error ID: {error.digest}
              </p>
            )}
          </details>
        )}

        <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
          <button
            type="button"
            onClick={reset}
            className={PRIMARY_ACTION_CLASS_NAME}
          >
            <RefreshCw className="mr-2 size-4" />
            Try Again
          </button>
          <Link
            href={asRoute(`${basePath || ''}/`)}
            className={OUTLINE_ACTION_CLASS_NAME}
          >
            <Home className="mr-2 size-4" />
            Go to Homepage
          </Link>
        </div>

        {/* Support message */}
        <p className="text-sm text-muted-foreground pt-4">
          If this problem persists, please{' '}
          <Link
            href={asRoute(`${basePath || ''}/pages/contact`)}
            className="text-primary hover:underline"
          >
            contact support
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
