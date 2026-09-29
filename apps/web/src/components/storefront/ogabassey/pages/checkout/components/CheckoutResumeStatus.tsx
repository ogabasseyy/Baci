'use client';

import { AlertCircle, Loader2 } from 'lucide-react';

type CheckoutResumeStatusProps =
  | { status: 'loading' | 'initializing' }
  | {
      status: 'error';
      message: string;
      onRetry: () => void;
      onGoHome: () => void;
      onContactSupport: () => void;
    };

/** Presents the blocking loading and recovery states for resumed checkouts. */
export function CheckoutResumeStatus(props: CheckoutResumeStatusProps) {
  if (props.status !== 'error') {
    return (
      <div className="ogabassey-checkout-page min-h-screen bg-store-background text-store-background-text flex items-center justify-center pb-20">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="size-12 animate-spin text-store-primary" />
          <p
            role="status"
            className="text-store-background-text/70 font-medium animate-pulse"
          >
            {props.status === 'loading'
              ? 'Loading order...'
              : 'Initializing secure checkout...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="ogabassey-checkout-page min-h-screen bg-store-background text-store-background-text flex items-center justify-center pb-20">
      <div className="text-center max-w-md mx-auto px-4">
        <div className="size-20 bg-store-secondary rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertCircle className="size-10 text-store-background-text/75" />
        </div>
        <h1 className="text-2xl font-bold text-store-background-text mb-2">
          Something Went Wrong
        </h1>
        <p className="text-store-background-text/70 mb-6">{props.message}</p>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={props.onRetry}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-store-primary text-store-primary-text font-semibold rounded-xl hover:bg-store-primary/90 transition-colors"
          >
            Try Again
          </button>
          <button
            type="button"
            onClick={props.onGoHome}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-store-border text-store-background-text font-semibold rounded-xl hover:bg-store-secondary transition-colors"
          >
            Go to Homepage
          </button>
        </div>
        <p className="text-xs text-store-background-text/60 mt-6">
          If this problem persists, please{' '}
          <button
            type="button"
            onClick={props.onContactSupport}
            className="text-store-primary underline"
          >
            contact support
          </button>
          .
        </p>
      </div>
    </div>
  );
}
