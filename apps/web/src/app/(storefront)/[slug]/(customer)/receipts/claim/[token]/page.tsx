import type { Metadata } from 'next';
import { Suspense } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  loadReceiptClaimPreview,
  parseReceiptClaimToken,
  recordReceiptClaimClickBestEffort,
} from '@/lib/import-notifications/receipt-claim-preview';
import { createClient } from '@/lib/supabase/server';
import ReceiptClaimPageClient from './receipt-claim-page-client';

interface ReceiptClaimPageProps {
  params: Promise<{ token: string }>;
}

export function generateMetadata(): Metadata {
  return {
    robots: {
      follow: false,
      index: false,
    },
  };
}

function ReceiptClaimLoadingShell() {
  return (
    <main className="min-h-screen bg-store-background px-4 py-10 text-store-background-text">
      <section className="mx-auto flex min-h-[70vh] max-w-2xl items-center">
        <Card className="w-full border-store-border bg-store-background shadow-sm">
          <CardHeader className="space-y-4">
            <div className="flex size-12 items-center justify-center rounded-full bg-store-primary/10 text-store-primary">
              <div
                aria-hidden="true"
                className="size-5 animate-spin rounded-full border-2 border-store-primary/30 border-t-store-primary"
              />
            </div>
            <div>
              <CardTitle className="text-2xl">Receipt claim</CardTitle>
              <CardDescription className="mt-2 text-base">
                Loading your receipt claim.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div
              aria-live="polite"
              className="rounded-md border border-store-border bg-store-secondary/60 p-4 text-sm font-medium text-store-background-text/70"
              role="status"
            >
              Preparing your receipt details...
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

export async function ReceiptClaimPreviewSection({ token }: { token: string }) {
  try {
    const supabase = await createClient();
    const preview = await loadReceiptClaimPreview({
      supabase,
      token,
    });

    if (preview.ok) {
      try {
        await recordReceiptClaimClickBestEffort({ supabase, token });
      } catch {
        // Click tracking must not block the receipt claim experience.
      }
    }

    return (
      <ReceiptClaimPageClient
        initialClaim={preview.ok ? preview.claim : null}
        initialError={preview.ok ? null : preview.error}
        token={token}
      />
    );
  } catch (error) {
    console.error('Failed to load receipt claim', error);

    return (
      <ReceiptClaimPageClient
        initialClaim={null}
        initialError="Failed to load receipt claim"
        token={token}
      />
    );
  }
}

export default async function ReceiptClaimPage({
  params,
}: ReceiptClaimPageProps) {
  const { token: rawToken } = await params;
  const token = parseReceiptClaimToken(rawToken);

  if (!token) {
    return (
      <Suspense fallback={<ReceiptClaimLoadingShell />}>
        <ReceiptClaimPageClient
          initialClaim={null}
          initialError="Invalid receipt claim link"
          token=""
        />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<ReceiptClaimLoadingShell />}>
      <ReceiptClaimPreviewSection token={token} />
    </Suspense>
  );
}
