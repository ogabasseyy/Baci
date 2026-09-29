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
      <div className="ogabassey-checkout-page min-h-screen bg-gray-50/50 flex items-center justify-center pb-20">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="size-12 animate-spin text-store-primary" />
          <p role="status" className="text-gray-500 font-medium animate-pulse">
            {props.status === 'loading'
              ? 'Loading order...'
              : 'Initializing secure checkout...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="ogabassey-checkout-page min-h-screen bg-gray-50/50 flex items-center justify-center pb-20">
      <div className="text-center max-w-md mx-auto px-4">
        <div className="size-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertCircle className="size-10 text-red-500" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Something Went Wrong
        </h1>
        <p className="text-gray-500 mb-6">{props.message}</p>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={props.onRetry}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-store-primary text-white font-semibold rounded-xl hover:bg-store-primary/90 transition-colors"
          >
            Try Again
          </button>
          <button
            type="button"
            onClick={props.onGoHome}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-gray-300 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-colors"
          >
            Go to Homepage
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-6">
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
