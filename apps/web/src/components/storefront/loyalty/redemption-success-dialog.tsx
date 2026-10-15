'use client';

import { Check, Copy } from 'lucide-react';
import { ThemedButton } from '@/components/themed';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';

export interface RedemptionSuccessResult {
  code: string;
  instructions: string;
  expiresAt: string;
  rewardType?: string;
  discountValue?: number;
}

interface RedemptionSuccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: RedemptionSuccessResult | null;
}

export function RedemptionSuccessDialog({
  open,
  onOpenChange,
  result,
}: RedemptionSuccessDialogProps) {
  const { toast } = useToast();
  // Store credit lands directly in the customer balance (no checkout
  // code is issued), so it gets credit-specific text and no code block.
  const isStoreCredit = result?.rewardType === 'store_credit';
  // Manual-fulfillment types issue a presentable code but no online
  // checkout path: directing these customers to checkout is a dead end,
  // so they get present-the-code copy instead. Valueless discounts join
  // them: neither checkout entry point bridges a code without a
  // positive value.
  const discountValue = result?.discountValue;
  const isManualFulfillment =
    result?.rewardType === 'free_product' ||
    result?.rewardType === 'exclusive_access' ||
    result?.rewardType === 'free_shipping' ||
    (result?.rewardType === 'discount' &&
      (discountValue == null || discountValue <= 0));

  const copyCode = async () => {
    if (!result?.code) return;
    try {
      // Confirm the write: clipboard access can be unavailable or
      // denied, and reporting success then loses the shopper's code.
      await navigator.clipboard.writeText(result.code);
      toast({
        title: 'Copied!',
        description: 'Redemption code copied to clipboard',
      });
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Select the code and copy it manually',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Check
              className="size-5"
              style={{ color: 'var(--store-primary)' }}
            />
            Reward Redeemed!
          </DialogTitle>
          <DialogDescription>
            {isStoreCredit
              ? 'Your reward has been successfully redeemed. The credit is now on your store balance.'
              : isManualFulfillment
                ? 'Your reward has been successfully redeemed. Present the code below as instructed.'
                : 'Your reward has been successfully redeemed. Use the code below at checkout.'}
          </DialogDescription>
        </DialogHeader>

        {result && (
          <div className="space-y-4">
            {!isStoreCredit && (
              <div className="p-4 bg-muted rounded-lg">
                <div className="flex items-center justify-between">
                  <code className="text-lg font-mono font-bold">
                    {result.code}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={copyCode}
                    aria-label="Copy redemption code"
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>
            )}

            <p className="text-sm text-muted-foreground">
              {result.instructions}
            </p>

            {/* Store credit lands in the balance immediately (no expiry
                mechanism), so the redemption expiry must not suggest the
                credited balance lapses. */}
            {result.expiresAt && !isStoreCredit && (
              <p className="text-xs text-muted-foreground">
                Expires:{' '}
                {new Date(result.expiresAt).toLocaleDateString('en-NG', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <ThemedButton onClick={() => onOpenChange(false)}>Done</ThemedButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
