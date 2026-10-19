'use client';

import { Check, Gift, Sparkles, Trophy, Users } from 'lucide-react';
import { useState } from 'react';
import { ThemedButton } from '@/components/themed';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLoyalty } from '@/hooks/use-loyalty';
import { useToast } from '@/hooks/use-toast';

interface LoyaltyEnrollmentFormProps {
  merchantId: string;
  customerId: string;
  merchantName?: string;
  onEnrolled?: () => void;
  onReceiptDismiss?: () => void;
}

interface SubmitLoyaltyEnrollmentParams {
  enroll: ReturnType<typeof useLoyalty>['enroll'];
  referralCode: string;
  toast: ReturnType<typeof useToast>['toast'];
  onEnrolled?: () => void;
  setEnrollmentData: (
    data: { points: number; referralCode: string } | null
  ) => void;
  setShowSuccess: (show: boolean) => void;
  setEnrolling: (enrolling: boolean) => void;
}

async function submitLoyaltyEnrollment({
  enroll,
  referralCode,
  toast,
  onEnrolled,
  setEnrollmentData,
  setShowSuccess,
  setEnrolling,
}: SubmitLoyaltyEnrollmentParams) {
  setEnrolling(true);
  try {
    const result = await enroll(referralCode || undefined);

    if (result.success) {
      setEnrollmentData({
        points: result.points_balance || 0,
        referralCode: result.referral_code || '',
      });
      setShowSuccess(true);
      toast({
        title: 'Welcome!',
        description: 'You have successfully joined our loyalty program',
      });
      onEnrolled?.();
    } else {
      toast({
        title: 'Enrollment Failed',
        description: result.error || 'Unable to join the loyalty program',
        variant: 'destructive',
      });
    }
  } finally {
    setEnrolling(false);
  }
}

export function LoyaltyEnrollmentForm({
  merchantId,
  customerId,
  merchantName = 'this store',
  onEnrolled,
  onReceiptDismiss,
}: LoyaltyEnrollmentFormProps) {
  const { toast } = useToast();
  const { enrolled, enroll, data, refetch } = useLoyalty(
    merchantId,
    customerId
  );
  const [referralCode, setReferralCode] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [enrollmentData, setEnrollmentData] = useState<{
    points: number;
    referralCode: string;
  } | null>(null);

  const handleEnroll = () => {
    void submitLoyaltyEnrollment({
      enroll,
      referralCode,
      toast,
      onEnrolled,
      setEnrollmentData,
      setShowSuccess,
      setEnrolling,
    });
  };

  // Dismissal must clear THIS component's receipt too: when the
  // post-enroll refresh failed, enrolled is still false, so the parent
  // keeps rendering the form — clearing only the parent's flag would
  // leave showSuccess set and "View my rewards" would look dead.
  // Clear locally and retry the status load so a recovered fetch
  // flips enrolled and the parent swaps to the rewards view.
  const handleReceiptDismiss = () => {
    setShowSuccess(false);
    setEnrollmentData(null);
    void refetch();
    onReceiptDismiss?.();
  };

  // The receipt renders before the enrolled branch below: the enroll
  // refresh flips enrolled before enroll() returns, and hiding on
  // enrolled first would discard the success card (points + referral
  // code) the shopper just earned.
  if (showSuccess && enrollmentData) {
    return (
      <Card className="border-green-200 bg-green-50">
        <CardContent className="pt-6">
          <div className="text-center">
            <div className="inline-flex items-center justify-center size-12 bg-green-100 rounded-full mb-4">
              <Check className="size-6 text-green-600" />
            </div>
            <h3 className="text-lg font-semibold text-green-900 mb-2">
              Welcome to the Club!
            </h3>
            <p className="text-sm text-green-700 mb-4">
              You&apos;ve earned {enrollmentData.points} welcome bonus points
            </p>

            {enrollmentData.referralCode && (
              <div className="p-3 bg-white rounded-lg border border-green-200">
                <p className="text-xs text-muted-foreground mb-1">
                  Your referral code
                </p>
                <code className="text-lg font-mono font-bold text-green-900">
                  {enrollmentData.referralCode}
                </code>
                <p className="text-xs text-muted-foreground mt-1">
                  Share with friends to earn bonus points
                </p>
              </div>
            )}
            {onReceiptDismiss && (
              <ThemedButton
                onClick={handleReceiptDismiss}
                className="w-full mt-4"
              >
                View my rewards
              </ThemedButton>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (enrolled) {
    return null; // Already enrolled, component should be hidden
  }

  const benefits = [
    { icon: Sparkles, text: 'Earn points on every purchase' },
    { icon: Gift, text: 'Redeem for discounts & rewards' },
    { icon: Users, text: 'Refer friends for bonus points' },
    { icon: Trophy, text: 'Unlock exclusive member tiers' },
  ];

  return (
    <Card className="overflow-hidden">
      <div className="bg-linear-to-r from-purple-600 to-pink-600 p-6 text-white">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="size-5" />
          <span className="font-semibold">Rewards Program</span>
        </div>
        <h3 className="text-xl font-bold mb-1">
          Join {merchantName}&apos;s Loyalty Program
        </h3>
        <p className="text-purple-100 text-sm">
          Earn points, unlock rewards, and enjoy exclusive benefits
        </p>
      </div>

      <CardContent className="pt-6">
        <div className="grid gap-3 mb-6">
          {benefits.map((benefit) => (
            <div key={benefit.text} className="flex items-center gap-3">
              <div className="p-1.5 bg-purple-100 rounded-full">
                <benefit.icon className="size-4 text-purple-600" />
              </div>
              <span className="text-sm">{benefit.text}</span>
            </div>
          ))}
        </div>

        {data?.settings?.welcome_bonus ? (
          <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 mb-4">
            <p className="text-sm text-amber-800 font-medium">
              🎁 Join now and get {data.settings.welcome_bonus} bonus points!
            </p>
          </div>
        ) : null}

        <div className="space-y-4">
          <div>
            <Label htmlFor="referralCode" className="text-sm">
              Have a referral code? (Optional)
            </Label>
            <Input
              id="referralCode"
              placeholder="Enter referral code"
              value={referralCode}
              onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
              className="mt-1"
            />
            {data?.settings?.referral_bonus_referee ? (
              <p className="text-xs text-muted-foreground mt-1">
                Get {data.settings.referral_bonus_referee} extra points with a
                valid referral code
              </p>
            ) : null}
          </div>

          <Button
            onClick={handleEnroll}
            disabled={enrolling}
            className="w-full bg-linear-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
          >
            {enrolling ? 'Joining...' : 'Join Loyalty Program'}
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            By joining, you agree to receive marketing communications from{' '}
            {merchantName}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
