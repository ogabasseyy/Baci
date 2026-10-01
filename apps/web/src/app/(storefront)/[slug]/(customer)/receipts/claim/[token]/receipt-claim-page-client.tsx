'use client';
import { AlertTriangle, Loader2, ReceiptText, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type MouseEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useCustomerAuth } from '@/contexts/customer-auth-context';
import { useMerchant } from '@/hooks/use-merchant-client';
import { fetchWithCsrf } from '@/lib/api-client';
import { sanitizeCustomerLoginEmailPrefill } from '@/lib/customer-login-prefill';
import { rememberReceiptClaimAppDownloadToken } from '@/lib/import-notifications/receipt-claim-app-download-storage';
import type { ReceiptClaimPreview } from '@/lib/import-notifications/receipt-claim-preview';
import { asRoute } from '@/lib/routes';
import ReceiptClaimAppLinks from './receipt-claim-app-links';
import {
  createDeviceListItems,
  joinBasePath,
  withReceiptClaimedSearchParam,
} from './receipt-claim-page-utils';
import { waitForReceiptClaimLoginStartedTrackingWindow } from './wait-for-receipt-claim-login-started-tracking';

interface ReceiptClaimPageClientProps {
  initialClaim: ReceiptClaimPreview | null;
  initialEmailHint: string;
  initialError: string | null;
  token: string;
}

export default function ReceiptClaimPageClient({
  initialClaim,
  initialEmailHint,
  initialError,
  token,
}: ReceiptClaimPageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { basePath, loading: merchantLoading, merchant } = useMerchant();
  const { isAuthenticated, isLoading: authLoading } = useCustomerAuth();
  const [error, setError] = useState<string | null>(initialError);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [redeemedToken, setRedeemedToken] = useState<string | null>(null);
  const loginNavigationInFlight = useRef(false);
  const redemptionInFlightToken = useRef<string | null>(null);
  const preview = initialClaim;
  const documentLabel =
    preview?.documentKind === 'invoice' ? 'invoice' : 'receipt';
  useEffect(() => {
    if (
      !token ||
      !preview ||
      preview.claimed ||
      error ||
      authLoading ||
      merchantLoading ||
      !isAuthenticated ||
      redemptionInFlightToken.current === token ||
      redeemedToken === token
    ) {
      return;
    }
    let cancelled = false;
    async function redeemClaim() {
      redemptionInFlightToken.current = token;
      setIsRedeeming(true);
      try {
        const response = await fetchWithCsrf(
          `/api/storefront/receipts/claims/${encodeURIComponent(token)}`,
          { method: 'POST' }
        );
        const data = (await response.json()) as {
          error?: string;
          redirectPath?: string;
          success?: boolean;
        };
        if (cancelled) {
          return;
        }
        if (!response.ok || !data.success) {
          setError(data.error || 'Unable to claim receipt');
          return;
        }
        setRedeemedToken(token);
        rememberReceiptClaimAppDownloadToken(token);
        router.push(
          asRoute(
            joinBasePath(
              basePath,
              withReceiptClaimedSearchParam(data.redirectPath || '/receipts')
            )
          )
        );
      } catch {
        if (!cancelled) {
          setError('Unable to claim receipt');
        }
      } finally {
        if (redemptionInFlightToken.current === token) {
          redemptionInFlightToken.current = null;
        }
        if (!cancelled) {
          setIsRedeeming(false);
        }
      }
    }
    void redeemClaim();
    return () => {
      cancelled = true;
    };
  }, [
    authLoading,
    basePath,
    error,
    isAuthenticated,
    merchantLoading,
    preview,
    redeemedToken,
    router,
    token,
  ]);
  const loginRedirectPath = joinBasePath(
    basePath,
    `/receipts/claim/${encodeURIComponent(token)}`
  );
  const loginSearchParams = new URLSearchParams({
    redirect: loginRedirectPath,
  });
  const emailHint =
    sanitizeCustomerLoginEmailPrefill(searchParams.get('email')) ||
    sanitizeCustomerLoginEmailPrefill(initialEmailHint);
  if (emailHint) {
    loginSearchParams.set('email', emailHint);
  }
  const loginPath = joinBasePath(
    basePath,
    `/account/login?${loginSearchParams.toString()}`
  );
  const shouldShowOgabasseyAppLinks =
    merchant?.slug === 'ogabassey' || basePath === '/ogabassey';

  async function handleLoginClick(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }
    if (loginNavigationInFlight.current) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    loginNavigationInFlight.current = true;
    try {
      await waitForReceiptClaimLoginStartedTrackingWindow(token);
      router.push(asRoute(loginPath));
    } finally {
      loginNavigationInFlight.current = false;
    }
  }

  return (
    <main className="min-h-screen bg-store-background px-4 py-10 text-store-background-text">
      <section className="mx-auto flex min-h-[70vh] max-w-2xl items-center">
        <Card className="w-full border-store-border bg-store-background shadow-sm">
          <CardHeader className="space-y-4">
            <div className="flex size-12 items-center justify-center rounded-full bg-store-primary/10 text-store-primary">
              {error ? (
                <AlertTriangle aria-hidden="true" className="size-6" />
              ) : (
                <ReceiptText aria-hidden="true" className="size-6" />
              )}
            </div>
            <div>
              <CardTitle className="text-2xl">
                {preview?.customerName
                  ? `Welcome ${preview.customerName}`
                  : 'Receipt claim'}
              </CardTitle>
              <CardDescription className="mt-2 text-base">
                {preview
                  ? `Your ${preview.merchantName} purchase is ready to link to your account.`
                  : 'Loading your receipt claim.'}
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {error ? (
              <div
                aria-live="polite"
                className="rounded-md border border-store-primary/30 bg-store-primary/10 p-4 text-sm font-medium text-store-background-text"
                role="status"
              >
                {error}
              </div>
            ) : preview ? (
              <>
                <div className="rounded-md border border-store-border bg-store-secondary/60 p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-store-primary">
                    <Smartphone aria-hidden="true" className="size-4" />
                    {documentLabel === 'invoice'
                      ? 'Device invoices'
                      : 'Device receipts'}
                  </div>
                  <ol className="space-y-2 pl-5 text-sm">
                    {createDeviceListItems(preview.devices).map((item) => (
                      <li key={item.key}>{item.device}</li>
                    ))}
                  </ol>
                </div>

                <p className="text-sm text-store-background-text/70">
                  {preview.claimed
                    ? `This ${documentLabel} link has already been claimed. You can view it from the receipts panel.`
                    : 'Sign in with the email address that received this link. We will open your receipts panel after verification.'}
                </p>

                {preview.claimed ? (
                  <Button
                    asChild
                    className="w-full bg-store-primary text-store-primary-text hover:bg-store-primary/90"
                  >
                    <Link href={asRoute(joinBasePath(basePath, '/receipts'))}>
                      View receipts
                    </Link>
                  </Button>
                ) : isAuthenticated ? (
                  <div className="flex items-center gap-3 text-sm font-medium text-store-background-text/70">
                    <Loader2
                      aria-hidden="true"
                      className="size-4 animate-spin"
                    />
                    <span>
                      {isRedeeming
                        ? `Claiming ${documentLabel}...`
                        : 'Preparing receipts...'}
                    </span>
                  </div>
                ) : (
                  <Button
                    asChild
                    className="w-full bg-store-primary text-store-primary-text hover:bg-store-primary/90"
                  >
                    <Link href={asRoute(loginPath)} onClick={handleLoginClick}>
                      Sign in to claim {documentLabel}
                    </Link>
                  </Button>
                )}

                {shouldShowOgabasseyAppLinks ? (
                  <ReceiptClaimAppLinks token={token} />
                ) : null}
              </>
            ) : (
              <div
                aria-live="polite"
                className="rounded-md border border-store-primary/30 bg-store-primary/10 p-4 text-sm font-medium text-store-background-text"
                role="status"
              >
                Unable to load receipt claim
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
