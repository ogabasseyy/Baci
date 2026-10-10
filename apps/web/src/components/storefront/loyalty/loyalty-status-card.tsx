'use client';

import { ArrowRight, Sparkles, Trophy } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useLoyalty } from '@/hooks/use-loyalty';

interface LoyaltyStatusCardProps {
  merchantId: string;
  customerId: string;
  compact?: boolean;
  /** Bumped by the parent after external mutations (e.g. a redemption in
   * the catalog) so this independent loyalty instance refetches too. */
  refreshToken?: number;
}

export function LoyaltyStatusCard({
  merchantId,
  customerId,
  compact = false,
  refreshToken = 0,
}: LoyaltyStatusCardProps) {
  const {
    data,
    loading,
    enrolled,
    pointsBalance,
    tier,
    nextTier,
    pointsToNextTier,
    getTierInfo,
    refetch,
  } = useLoyalty(merchantId, customerId);

  // Token-driven refetch via a ref: refetch is a new function identity
  // every render by design, so depending on it directly would refetch in
  // a loop. The effect only fires when the parent bumps refreshToken.
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  useEffect(() => {
    if (refreshToken > 0) {
      void refetchRef.current();
    }
  }, [refreshToken]);

  if (loading) {
    return (
      <Card>
        <CardHeader className={compact ? 'pb-2' : ''}>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-24 mb-2" />
          <Skeleton className="h-2 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!enrolled || !data) {
    return null;
  }

  const tierInfo = getTierInfo(tier);
  // Server-computed against the merchant ladder: lifetime can sit below a
  // raised current threshold, which local subtraction turns into negative
  // or NaN progress.
  const progressPercentage = nextTier ? data.tier_progress : 100;

  if (compact) {
    return (
      <div className="flex items-center gap-3 p-3 bg-linear-to-r from-purple-50 to-pink-50 rounded-lg">
        <div className="p-2 bg-white rounded-full shadow-sm">
          <Sparkles className="size-4 text-purple-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-lg">
              {pointsBalance.toLocaleString()}
            </span>
            <span className="text-sm text-muted-foreground">points</span>
            <Badge
              className={`${tierInfo.colors.bg} ${tierInfo.colors.text} ml-auto`}
            >
              {tier.charAt(0).toUpperCase() + tier.slice(1)}
            </Badge>
          </div>
          {nextTier && (
            <p className="text-xs text-muted-foreground truncate">
              {pointsToNextTier.toLocaleString()} pts to {nextTier}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="bg-linear-to-r from-purple-600 to-pink-600 p-4 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="size-5" />
            <span className="font-medium">Rewards Member</span>
          </div>
          <Badge
            className={`${tierInfo.colors.bg} ${tierInfo.colors.text} ${tierInfo.colors.border} border`}
          >
            {tier.charAt(0).toUpperCase() + tier.slice(1)}
          </Badge>
        </div>
      </div>

      <CardContent className="pt-4">
        <div className="text-center mb-4">
          <div className="text-3xl font-bold">
            {pointsBalance.toLocaleString()}
          </div>
          <div className="text-sm text-muted-foreground">Available Points</div>
        </div>

        {nextTier && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Progress to {nextTier}
              </span>
              <span className="font-medium">
                {pointsToNextTier.toLocaleString()} pts to go
              </span>
            </div>
            <Progress value={progressPercentage} className="h-2" />
          </div>
        )}

        <div className="mt-4 pt-4 border-t">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Lifetime Points</span>
            <span className="font-medium">
              {data.lifetime_points.toLocaleString()}
            </span>
          </div>
        </div>

        {data.referral_code && (
          <div className="mt-4 pt-4 border-t">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Your referral code</span>
              <span className="font-mono font-medium">
                {data.referral_code}
              </span>
            </div>
          </div>
        )}

        {data.redeemable_rewards.length > 0 && (
          <div className="mt-4 p-3 bg-green-50 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-green-800">
                  {data.redeemable_rewards.length} reward
                  {data.redeemable_rewards.length > 1 ? 's' : ''} available!
                </p>
                <p className="text-xs text-green-600">Redeem your points now</p>
              </div>
              <ArrowRight className="size-4 text-green-600" />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
