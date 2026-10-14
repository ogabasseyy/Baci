'use client';
import { AlertCircle, Gift, Sparkles, Truck, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useLoyalty } from '@/hooks/use-loyalty';
import { useToast } from '@/hooks/use-toast';
import { formatMerchantCurrency } from '@/lib/resolve-merchant-currency';
import {
  RedemptionSuccessDialog,
  type RedemptionSuccessResult,
} from './redemption-success-dialog';

interface RewardsCatalogProps {
  merchantId: string;
  customerId: string;
  /** Merchant's country/payout currency, used to render fixed-value reward
   * labels (e.g. "₦2,000 Off") in the merchant's own currency instead of a
   * hardcoded ₦. */
  merchantCountry?: string | null;
  merchantPayoutCurrency?: string | null;
  /** Fired after a redemption attempt (success or failure) so embedding
   * views (page-level history, status card) can refetch their own loyalty
   * instances. Failures fire too: the RPC commits expiry reconciliation
   * before validating, so a failed attempt can still mutate the balance. */
  onRedeemed?: () => void;
}
// The status route never sends min_tier and the redemption RPC enforces no
// tier gate, so redeemability here is purely "can afford it".
interface Reward {
  id: string;
  name: string;
  description: string;
  points_required: number;
  reward_type:
    | 'discount'
    | 'free_shipping'
    | 'free_product'
    | 'exclusive_access'
    | 'store_credit';
  discount_type?: 'percentage' | 'fixed';
  discount_value?: number;
  minimum_order_amount?: number;
}
const rewardIcons = {
  discount: Gift,
  free_shipping: Truck,
  free_product: Gift,
  exclusive_access: Sparkles,
  store_credit: Wallet,
};
export function RewardsCatalog({
  merchantId,
  customerId,
  merchantCountry,
  merchantPayoutCurrency,
  onRedeemed,
}: RewardsCatalogProps) {
  const { toast } = useToast();
  const {
    loading,
    enrolled,
    pointsBalance,
    maxRedemptionPercentage,
    availableRewards,
    redeemReward,
    refetch,
  } = useLoyalty(merchantId, customerId);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [redemptionResult, setRedemptionResult] =
    useState<RedemptionSuccessResult | null>(null);
  const handleRedeem = (reward: Reward) => {
    setRedeeming(reward.id);
    // Promise chain instead of try/finally so the React Compiler can
    // memoize this component (it cannot lower try/finally statements yet).
    return redeemReward(reward.id)
      .then((result) => {
        if (result.success) {
          setRedemptionResult({
            code: result.redemption_code || '',
            instructions: result.instructions || '',
            expiresAt: result.expires_at || '',
            rewardType: result.reward_type,
            discountValue: result.discount_value,
          });
          setShowSuccessDialog(true);
          onRedeemed?.();
        } else {
          // The RPC commits expiry reconciliation before validating, so a
          // failed attempt can still mutate the balance: refresh every
          // view, not just this catalog's own instance.
          void refetch();
          onRedeemed?.();
          toast({
            title: 'Redemption Failed',
            description: result.error || 'Unable to redeem reward',
            variant: 'destructive',
          });
        }
      })
      .finally(() => {
        setRedeeming(null);
      });
  };
  const canRedeem = (reward: Reward): boolean =>
    pointsBalance >= reward.points_required;
  const getRewardLabel = (reward: Reward): string => {
    if (reward.reward_type === 'discount') {
      // Valueless plain discounts are manual, present-the-code
      // benefits: never render them as a ₦0 fixed amount.
      if (reward.discount_value == null || reward.discount_value <= 0) {
        return 'In-Store Discount';
      }
      if (reward.discount_type === 'percentage') {
        // A program cap below the face value binds at checkout:
        // advertise the effective percentage, not the nominal one.
        const effective =
          maxRedemptionPercentage != null && maxRedemptionPercentage > 0
            ? Math.min(reward.discount_value ?? 0, maxRedemptionPercentage)
            : (reward.discount_value ?? 0);
        return `${effective}% Off`;
      }
      const formattedValue = formatMerchantCurrency(
        reward.discount_value ?? 0,
        { country: merchantCountry, payout_currency: merchantPayoutCurrency },
        { maximumFractionDigits: 0 }
      );
      return `${formattedValue} Off`;
    }
    if (reward.reward_type === 'free_shipping') {
      return 'Free Shipping';
    }
    if (reward.reward_type === 'free_product') {
      return 'Free Product';
    }
    if (reward.reward_type === 'store_credit') {
      // Up to 2 fraction digits: the RPC credits the exact value (e.g.
      // USD 5.50), so rounding to $6 would advertise money never paid.
      const formattedValue = formatMerchantCurrency(
        reward.discount_value ?? 0,
        { country: merchantCountry, payout_currency: merchantPayoutCurrency },
        // Explicit minimum: the shared normalizer would otherwise pin
        // whole values to .00 when only a maximum is given.
        { minimumFractionDigits: 0, maximumFractionDigits: 2 }
      );
      return `${formattedValue} Store Credit`;
    }
    return 'Exclusive Access';
  };
  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-32" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-4 w-full" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-10 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }
  if (!enrolled) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <AlertCircle className="size-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="font-semibold mb-2">Join to See Rewards</h3>
          <p className="text-sm text-muted-foreground">
            Enroll in our loyalty program to view and redeem rewards
          </p>
        </CardContent>
      </Card>
    );
  }
  if (availableRewards.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Gift className="size-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="font-semibold mb-2">No Rewards Available</h3>
          <p className="text-sm text-muted-foreground">
            Check back later for new rewards
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Available Rewards</h2>
          <Badge variant="outline">
            {pointsBalance.toLocaleString()} points available
          </Badge>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {availableRewards.map((reward) => {
            const Icon = rewardIcons[reward.reward_type];
            const isRedeemable = canRedeem(reward);

            return (
              <Card
                key={reward.id}
                className={!isRedeemable ? 'opacity-75' : ''}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="p-2 bg-primary/10 rounded-lg">
                      <Icon className="size-5 text-primary" />
                    </div>
                    <Badge variant="secondary">{getRewardLabel(reward)}</Badge>
                  </div>
                  <CardTitle className="text-base mt-2">
                    {reward.name}
                  </CardTitle>
                  <CardDescription className="text-sm">
                    {reward.description}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-muted-foreground">Cost</span>
                    <span className="font-semibold">
                      {reward.points_required.toLocaleString()} pts
                    </span>
                  </div>
                  {/* Minimums apply at online checkout, which bridges
                      discount rewards only: manual-fulfillment types must
                      not advertise a threshold they never enforce. */}
                  {maxRedemptionPercentage != null &&
                    maxRedemptionPercentage > 0 &&
                    maxRedemptionPercentage < 100 &&
                    reward.reward_type === 'discount' &&
                    (reward.discount_value ?? 0) > 0 && (
                      <p className="text-xs text-muted-foreground mb-3">
                        Discount capped at {maxRedemptionPercentage}% of the
                        order subtotal
                      </p>
                    )}
                  {(reward.minimum_order_amount ?? 0) > 0 &&
                    reward.reward_type === 'discount' && (
                      <p className="text-xs text-muted-foreground mb-3">
                        Min. order{' '}
                        {formatMerchantCurrency(
                          reward.minimum_order_amount ?? 0,
                          {
                            country: merchantCountry,
                            payout_currency: merchantPayoutCurrency,
                          },
                          { maximumFractionDigits: 0 }
                        )}{' '}
                        at checkout
                      </p>
                    )}

                  <Button
                    className="w-full"
                    disabled={!isRedeemable || redeeming === reward.id}
                    onClick={() => handleRedeem(reward)}
                  >
                    {redeeming === reward.id
                      ? 'Redeeming...'
                      : !isRedeemable
                        ? `Need ${(reward.points_required - pointsBalance).toLocaleString()} more pts`
                        : 'Redeem'}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <RedemptionSuccessDialog
        open={showSuccessDialog}
        onOpenChange={setShowSuccessDialog}
        result={redemptionResult}
      />
    </>
  );
}
