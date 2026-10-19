'use client';

import { Gift, History, Trophy } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { LoyaltyEnrollmentForm } from '@/components/storefront/loyalty/loyalty-enrollment-form';
import { LoyaltyStatusCard } from '@/components/storefront/loyalty/loyalty-status-card';
import { RewardsCatalog } from '@/components/storefront/loyalty/rewards-catalog';
import { RewardsHistory } from '@/components/storefront/loyalty/rewards-history';
import { RewardsSignInPrompt } from '@/components/storefront/loyalty/rewards-sign-in-prompt';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCustomerAuth } from '@/contexts/customer-auth-context';
import { useLoyalty } from '@/hooks/use-loyalty';
import { useMerchantSafe } from '@/hooks/use-merchant-client';

export default function RewardsPage() {
  const params = useParams();
  const slug = params.slug as string;

  // Get customer from auth context (more secure than localStorage)
  const { customer } = useCustomerAuth();
  // Derive directly from the auth context instead of mirroring it into state
  const customerId = customer?.id ?? null;

  // Merchant identity + currency (country/payout_currency) come from the
  // merchant context instead of a dedicated fetch. `useMerchantSafe` (not the
  // throwing `useMerchant`) because this page renders under
  // `StorefrontMerchantProvider` in production but has no provider ancestor
  // in its unit tests.
  const merchantCurrencyContext = useMerchantSafe();
  const merchantId = merchantCurrencyContext?.merchant?.id ?? null;
  const merchantName = merchantCurrencyContext?.merchant?.business_name ?? '';
  const merchantCountry = merchantCurrencyContext?.merchant?.country ?? null;
  const merchantPayoutCurrency =
    merchantCurrencyContext?.merchant?.payout_currency ?? null;

  const { enrolled, loading, recentTransactions, getTierInfo, tier, refetch } =
    useLoyalty(merchantId || undefined, customerId || undefined);

  // The page, status card, and catalog each own a useLoyalty instance: a
  // redemption inside the catalog must refresh the other two as well, or
  // the balance and history go stale until a reload.
  const [refreshToken, setRefreshToken] = useState(0);
  const handleRedeemed = () => {
    void refetch();
    setRefreshToken((token) => token + 1);
  };

  // Keeps the enrollment receipt mounted after the page-level refetch
  // reports enrolled: without this, onEnrolled's refetch flips the
  // subtree to the status card and unmounts the form, discarding the
  // success card (points + referral code) before the shopper dismisses
  // it. Cleared on dismiss or identity change.
  const [showEnrollmentReceipt, setShowEnrollmentReceipt] = useState(false);
  const handleEnrolled = () => {
    setShowEnrollmentReceipt(true);
    void refetch();
  };

  // The skeleton shows until the first settled fetch for THIS identity. A
  // same-identity background refetch (e.g. after onRedeemed) keeps the
  // enrolled subtree mounted so the success dialog survives; a merchant or
  // customer change mismatches immediately (before the new fetch lands),
  // so the previous shopper's data never paints.
  const identity = `${merchantId ?? ''}:${customerId ?? ''}`;
  const [loadedIdentity, setLoadedIdentity] = useState<string | null>(null);
  // Mark loaded only on a true->false edge, and never on the
  // identity-change commit itself: the hook's data and loading still
  // describe the previous identity there, so stamping would flash
  // stale shopper data. Synchronous preview/demo loads settle inside
  // the hook's effect (declared above) without a loading edge; the
  // follow-up render carries the new identity's data with loading
  // false, and the tracker reset lets that render stamp instead of
  // leaving the skeleton up forever.
  const wasLoading = useRef(true);
  const seenIdentity = useRef(identity);
  // No dep array: the follow-up render that carries a synchronous
  // load's data changes neither identity nor loading, so the stamp
  // check must run on every commit.
  useEffect(() => {
    if (seenIdentity.current !== identity) {
      seenIdentity.current = identity;
      wasLoading.current = true;
      setShowEnrollmentReceipt(false);
      return;
    }
    if (wasLoading.current && !loading) setLoadedIdentity(identity);
    wasLoading.current = loading;
  });
  // No loading term: same-identity refetches keep content (dialog
  // survives), while a new identity skeletons on the very first render.
  const showSkeleton = loadedIdentity !== identity;

  // Loading state
  if (!merchantId) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <h1 className="sr-only">Rewards</h1>
        <div className="space-y-6">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  // Not logged in state
  if (!customerId) {
    return <RewardsSignInPrompt slug={slug} />;
  }

  const tierInfo = tier ? getTierInfo(tier) : null;
  const displayTier = tier
    ? tier.charAt(0).toUpperCase() + tier.slice(1)
    : 'Member';

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">My Rewards</h1>
        <p className="text-muted-foreground">
          Earn points, unlock rewards, and enjoy exclusive member benefits
        </p>
      </div>

      {showSkeleton ? (
        <div className="space-y-6">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : !enrolled || showEnrollmentReceipt ? (
        <LoyaltyEnrollmentForm
          merchantId={merchantId}
          customerId={customerId}
          merchantName={merchantName}
          onEnrolled={handleEnrolled}
          onReceiptDismiss={() => {
            setShowEnrollmentReceipt(false);
            // The child's own retry may already have recovered the
            // enrollment while this page-level state still says
            // not-enrolled; refetch so dismissal cannot strand the
            // rewards area on the now-empty form branch.
            void refetch();
          }}
        />
      ) : (
        <div className="space-y-6">
          {/* Status Card */}
          <LoyaltyStatusCard
            merchantId={merchantId}
            customerId={customerId}
            refreshToken={refreshToken}
          />

          {/* Tier Benefits */}
          {tierInfo && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Trophy className="size-5" />
                    {displayTier} Member
                  </CardTitle>
                  <Badge
                    className={`${tierInfo.colors.bg} ${tierInfo.colors.text}`}
                  >
                    Current Tier
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">
                  Your tier benefits:
                </p>
                <ul className="space-y-2">
                  {tierInfo.benefits.map((benefit) => (
                    <li
                      key={benefit}
                      className="flex items-center gap-2 text-sm"
                    >
                      <div className="size-1.5 bg-primary rounded-full" />
                      {benefit}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Tabs for Rewards and History */}
          <Tabs defaultValue="rewards">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="rewards" className="flex items-center gap-2">
                <Gift className="size-4" />
                Rewards
              </TabsTrigger>
              <TabsTrigger value="history" className="flex items-center gap-2">
                <History className="size-4" />
                History
              </TabsTrigger>
            </TabsList>

            <TabsContent value="rewards" className="mt-4">
              <RewardsCatalog
                merchantId={merchantId}
                customerId={customerId}
                merchantCountry={merchantCountry}
                merchantPayoutCurrency={merchantPayoutCurrency}
                onRedeemed={handleRedeemed}
              />
            </TabsContent>

            <TabsContent value="history" className="mt-4">
              <RewardsHistory transactions={recentTransactions} />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}
