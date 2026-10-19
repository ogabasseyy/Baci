'use client';

import { Check, Loader2, Tag, X } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useCurrencyWithCountry } from '@/hooks/use-currency';
import { useToast } from '@/hooks/use-toast';
import { buildCsrfHeaders } from '@/lib/csrf';

export interface DiscountResult {
  valid: boolean;
  code: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  // Loyalty codes validate with an explicit null id; merchant codes
  // carry their row id.
  discount_code_id?: string | null;
  // Server-computed amount — the UI source of truth so caps + rounding stay
  // aligned with the order route and the redemption RPC.
  discount_amount?: number;
  minimum_order?: number;
  description?: string;
  error?: string;
}

interface DiscountTargeting {
  productIds?: string[];
  categoryIds?: string[];
}

interface DiscountCodeInputProps extends DiscountTargeting {
  merchantId: string;
  cartTotal: number;
  onApply: (discount: DiscountResult) => void;
  onRemove: () => void;
  appliedDiscount?: DiscountResult | null;
  currencyCountryCode?: string | null;
  payoutCurrency?: string | null;
}

async function validateDiscountCode(
  merchantId: string,
  code: string,
  cartTotal: number,
  targeting: DiscountTargeting,
  retry = false
): Promise<DiscountResult> {
  // If retry, refresh CSRF token first
  if (retry) {
    const csrfResponse = await fetch('/api/csrf');
    if (!csrfResponse.ok) {
      throw new Error(
        `Failed to refresh CSRF token (status ${csrfResponse.status})`
      );
    }
  }

  const response = await fetch('/api/storefront/discount/validate', {
    method: 'POST',
    headers: {
      ...buildCsrfHeaders(),
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({
      merchant_id: merchantId,
      code: code.trim().toUpperCase(),
      cart_total: cartTotal,
      ...(targeting.productIds?.length
        ? { product_ids: targeting.productIds }
        : {}),
      ...(targeting.categoryIds?.length
        ? { category_ids: targeting.categoryIds }
        : {}),
    }),
  });

  // If CSRF error and haven't retried, try once more
  if (response.status === 403 && !retry) {
    const errorData = await response.json();
    if (errorData.error === 'Invalid CSRF token') {
      return validateDiscountCode(merchantId, code, cartTotal, targeting, true);
    }

    return errorData;
  }

  return response.json();
}

async function requestDiscountValidation(
  merchantId: string,
  code: string,
  cartTotal: number,
  targeting: DiscountTargeting
): Promise<DiscountResult | null> {
  try {
    return await validateDiscountCode(merchantId, code, cartTotal, targeting);
  } catch (err) {
    console.error('Error validating discount code:', err);
    return null;
  }
}

export function DiscountCodeInput({
  merchantId,
  cartTotal,
  onApply,
  onRemove,
  appliedDiscount,
  productIds,
  categoryIds,
  currencyCountryCode,
  payoutCurrency,
}: DiscountCodeInputProps) {
  const { toast } = useToast();
  const { formatCurrencyCompact } = useCurrencyWithCountry(
    currencyCountryCode ?? 'NG',
    payoutCurrency ?? null
  );
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApply = async () => {
    if (!code.trim()) {
      setError('Please enter a discount code');
      return;
    }

    setLoading(true);
    setError(null);

    const result = await requestDiscountValidation(
      merchantId,
      code,
      cartTotal,
      {
        productIds,
        categoryIds,
      }
    );
    setLoading(false);

    if (!result) {
      setError('Failed to validate code. Please try again.');
      return;
    }

    if (!result.valid) {
      setError(result.error || 'Invalid discount code');
      toast({
        title: 'Invalid Code',
        description: result.error || 'This discount code is not valid',
        variant: 'destructive',
      });
      return;
    }

    onApply(result);
    setCode('');
    toast({
      title: 'Discount Applied',
      description: `${result.discount_type === 'percentage' ? `${result.discount_value}% off` : `${formatCurrencyCompact(result.discount_value)} off`} applied to your order`,
    });
  };

  const handleRemove = () => {
    onRemove();
    setCode('');
    setError(null);
    toast({
      title: 'Discount Removed',
      description: 'The discount has been removed from your order',
    });
  };

  const formatDiscount = (discount: DiscountResult) => {
    if (discount.discount_type === 'percentage') {
      return `${discount.discount_value}% off`;
    }
    return `${formatCurrencyCompact(discount.discount_value)} off`;
  };

  // Show applied discount
  if (appliedDiscount) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-green-100 rounded-full">
              <Check className="size-4 text-green-600" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-green-800">
                  {appliedDiscount.code}
                </span>
                <Badge variant="secondary" className="text-xs">
                  {formatDiscount(appliedDiscount)}
                </Badge>
              </div>
              {appliedDiscount.description && (
                <p className="text-xs text-green-600">
                  {appliedDiscount.description}
                </p>
              )}
            </div>
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRemove}
                  className="size-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-100"
                  aria-label="Remove discount code"
                >
                  <X className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Remove discount</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Tag className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            aria-label="Discount code"
            placeholder="Enter discount code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleApply();
              }
            }}
            className="pl-9"
            disabled={loading}
          />
        </div>
        <Button
          onClick={handleApply}
          disabled={loading || !code.trim()}
          variant="outline"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : 'Apply'}
        </Button>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
