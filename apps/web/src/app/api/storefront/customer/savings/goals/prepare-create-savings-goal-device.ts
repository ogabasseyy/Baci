import { NextResponse } from 'next/server';
import {
  resolveSavingsDeviceSelection,
  SAVINGS_DEVICE_PRODUCT_SELECT,
  SavingsDeviceProductSchema,
  type SavingsDeviceSnapshot,
} from '@/lib/customer-savings-device';

type EqChain = {
  eq: (column: string, value: string) => EqChain;
  maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }>;
};

export type SavingsProductQueryClient = {
  from: (table: 'products') => {
    select: (columns: typeof SAVINGS_DEVICE_PRODUCT_SELECT) => EqChain;
  };
};

export async function prepareCreateSavingsGoalDevice({
  merchantId,
  productId,
  supabase,
  targetAmount,
  variantId,
}: {
  merchantId: string;
  productId: string;
  supabase: SavingsProductQueryClient;
  targetAmount: number;
  variantId?: string | null;
}): Promise<
  | { response: NextResponse }
  | {
      device: {
        snapshot: SavingsDeviceSnapshot;
        targetAmount: number;
        variantId: string | null;
      };
    }
> {
  const productResult = await supabase
    .from('products')
    .select(SAVINGS_DEVICE_PRODUCT_SELECT)
    .eq('merchant_id', merchantId)
    .eq('id', productId)
    .eq('status', 'active')
    .maybeSingle();

  if (productResult.error) {
    throw productResult.error;
  }

  const productValidation = SavingsDeviceProductSchema.safeParse(
    productResult.data
  );
  if (!productValidation.success) {
    return {
      response: NextResponse.json(
        {
          code: 'SAVINGS_DEVICE_PRODUCT_NOT_FOUND',
          error: 'Savings device is not available',
        },
        { status: 404 }
      ),
    };
  }

  const device = resolveSavingsDeviceSelection({
    clientTargetAmount: targetAmount,
    product: productValidation.data,
    variantId,
  });
  if (!device.ok) {
    return {
      response: NextResponse.json(
        { code: device.code, error: device.error },
        { status: device.status }
      ),
    };
  }

  return {
    device: {
      snapshot: device.snapshot,
      targetAmount: device.targetAmount,
      variantId: device.variantId,
    },
  };
}
