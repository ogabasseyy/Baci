'use client';

import {
  Award,
  Gift,
  History,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { LoyaltyEnrollmentForm } from '@/components/storefront/loyalty/loyalty-enrollment-form';
import { LoyaltyStatusCard } from '@/components/storefront/loyalty/loyalty-status-card';
import { RewardsCatalog } from '@/components/storefront/loyalty/rewards-catalog';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center size-16 bg-purple-100 rounded-full mb-4">
            <Sparkles className="size-8 text-purple-600" />
          </div>
          <h1 className="text-3xl font-bold mb-2">Rewards Program</h1>
          <p className="text-muted-foreground max-w-md mx-auto">
            Sign in to your account to view your rewards, earn points, and
            redeem exclusive offers
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign in to access rewards</CardTitle>
            <CardDescription>
              Already have an account? Sign in to view your points and rewards.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href={`/${slug}/account/login?redirect=/${slug}/pages/rewards`}
              className="inline-flex items-center justify-center w-full px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
            >
              Sign In to Continue
            </Link>
          </CardContent>
        </Card>

        {/* Show benefits preview */}
        <div className="mt-8">
          <h2 className="text-xl font-semibold mb-4">Member Benefits</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: Sparkles,
                title: 'Earn Points',
                description: 'Get points on every purchase',
              },
              {
                icon: Gift,
                title: 'Redeem Rewards',
                description: 'Exchange points for discounts',
              },
              {
                icon: Trophy,
                title: 'Unlock Tiers',
                description: 'Rise through member levels',
              },
              {
                icon: Award,
                title: 'Exclusive Access',
                description: 'Early access to sales',
              },
            ].map((benefit) => (
              <Card key={benefit.title}>
                <CardContent className="pt-6">
                  <div className="flex flex-col items-center text-center">
                    <div className="p-3 bg-purple-100 rounded-full mb-3">
                      <benefit.icon className="size-6 text-purple-600" />
                    </div>
                    <h3 className="font-medium mb-1">{benefit.title}</h3>
                    <p className="text-sm text-muted-foreground">
                      {benefit.description}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
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

      {loading ? (
        <div className="space-y-6">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : !enrolled ? (
        <LoyaltyEnrollmentForm
          merchantId={merchantId}
          customerId={customerId}
          merchantName={merchantName}
          onEnrolled={refetch}
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
              <Card>
                <CardHeader>
                  <CardTitle>Points History</CardTitle>
                  <CardDescription>Your recent points activity</CardDescription>
                </CardHeader>
                <CardContent>
                  {recentTransactions.length === 0 ? (
                    <div className="text-center py-8">
                      <History className="size-12 mx-auto text-muted-foreground mb-4" />
                      <p className="text-muted-foreground">
                        No transactions yet
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Make a purchase to start earning points
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {recentTransactions.map((transaction) => (
                        <div
                          key={transaction.id}
                          className="flex items-center justify-between py-3 border-b last:border-0"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`p-2 rounded-full ${
                                transaction.points > 0
                                  ? 'bg-green-100'
                                  : 'bg-red-100'
                              }`}
                            >
                              {transaction.points > 0 ? (
                                <TrendingUp className="size-4 text-green-600" />
                              ) : (
                                <TrendingDown className="size-4 text-red-600" />
                              )}
                            </div>
                            <div>
                              <p className="font-medium text-sm">
                                {transaction.description}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(
                                  transaction.created_at
                                ).toLocaleDateString(undefined, {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </p>
                            </div>
                          </div>
                          <span
                            className={`font-semibold ${
                              transaction.points > 0
                                ? 'text-green-600'
                                : 'text-red-600'
                            }`}
                          >
                            {transaction.points > 0 ? '+' : ''}
                            {transaction.points.toLocaleString()} pts
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}
