'use client';

import { Check, Copy } from 'lucide-react';
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

  const copyCode = () => {
    if (result?.code) {
      navigator.clipboard.writeText(result.code);
      toast({
        title: 'Copied!',
        description: 'Redemption code copied to clipboard',
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

            {result.expiresAt && (
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
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
