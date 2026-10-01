import { type NextRequest, NextResponse } from 'next/server';
import { getCronSecret } from '@/env';
import { hasValidCronSecret } from '@/lib/cron-secret-auth';
import { logger } from '@/lib/logger';
import { provisionMerchantWalletFundingRecoveryHmac } from '@/lib/provision-merchant-wallet-funding-recovery-hmac';
import { createWalletFundingRecoveryHmacServiceClient } from '@/lib/wallet/server-funding-recovery-hmac-client';

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  if (!hasValidCronSecret(request.headers, getCronSecret())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createWalletFundingRecoveryHmacServiceClient();
    await provisionMerchantWalletFundingRecoveryHmac(supabase);
    return NextResponse.json({ provisioned: true, success: true });
  } catch (error) {
    logger.error({
      error,
      message: 'Failed to provision merchant wallet funding recovery HMAC',
    });
    return NextResponse.json(
      { error: 'Failed to provision funding recovery HMAC' },
      { status: 500 }
    );
  }
}
