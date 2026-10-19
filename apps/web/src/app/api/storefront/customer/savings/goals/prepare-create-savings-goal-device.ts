import { NextResponse } from 'next/server';
import {
  readSavingsDeviceProduct,
  resolveSavingsDeviceSelection,
  type SavingsDeviceQueryClient,
  type SavingsDeviceSnapshot,
} from '@/lib/customer-savings-device';

export type SavingsProductQueryClient = SavingsDeviceQueryClient;

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
  const product = await readSavingsDeviceProduct({
    merchantId,
    productId,
    supabase,
  });

  if (!product) {
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
    product,
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
