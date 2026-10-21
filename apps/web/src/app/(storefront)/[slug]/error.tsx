'use client';

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
          <svg
            aria-hidden="true"
            className="size-10 text-destructive"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
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
            <svg
              aria-hidden="true"
              className="mr-2 size-4"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M8 16H3v5" />
            </svg>
            Try Again
          </button>
          <Link
            href={asRoute(`${basePath || ''}/`)}
            className={OUTLINE_ACTION_CLASS_NAME}
          >
            <svg
              aria-hidden="true"
              className="mr-2 size-4"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
              <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
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
