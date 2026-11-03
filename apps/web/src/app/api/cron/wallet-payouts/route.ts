import { NextResponse } from 'next/server';
import { getCronSecret } from '@/env';
import { hasValidCronSecret } from '@/lib/cron-secret-auth';
import { payoutMerchantCommission } from '@/lib/kuda';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * POST /api/cron/wallet-payouts
 *
 * Manual fallback only - DO NOT re-enable Vercel Cron for this route.
 * Scheduled execution lives in vps-workers; keep CRON_SECRET gating intact.
 *
 * Processes all merchant wallets where:
 * - auto_payout_enabled = true
 * - auto_payout_day = current day
 * - available_balance >= min_payout_amount
 *
 * Security: Requires CRON_SECRET header
 */
export async function POST(request: Request) {
  try {
    // Verify cron secret
    if (!hasValidCronSecret(request.headers, getCronSecret())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient();

    // Get current day of week
    const days = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ];
    const today = days[new Date().getDay()];

    // Get all wallets eligible for payout today
    const { data: wallets, error: walletsError } = await supabase
      .from('merchant_wallets')
      .select(
        `
        id,
        merchant_id,
        available_balance,
        min_payout_amount,
        merchants (
          id,
          business_name,
          bank_account_number,
          bank_code,
          bank_account_name
        )
      `
      )
      .eq('auto_payout_enabled', true)
      .eq('auto_payout_day', today)
      .gte('available_balance', 100); // At least ₦100

    if (walletsError) {
      console.error('Failed to fetch wallets for payout:', walletsError);
      return NextResponse.json(
        { error: 'Failed to fetch wallets' },
        { status: 500 }
      );
    }

    const results = {
      processed: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      details: [] as Array<{
        merchantId: string;
        status: string;
        amount?: number;
        error?: string;
      }>,
    };

    for (const wallet of wallets || []) {
      const merchant = wallet.merchants as unknown as {
        id: string;
        business_name: string;
        bank_account_number: string | null;
        bank_code: string | null;
        bank_account_name: string | null;
      };

      const minPayoutAmount = Number(wallet.min_payout_amount);

      // Paystack-settled money cannot be paid out, so pay only the spendable
      // balance (<= available_balance). Fail closed: never fall back to the
      // raw available_balance when the RPC errors or returns junk.
      const { data: spendableRaw, error: spendableError } = await supabase.rpc(
        'get_merchant_wallet_spendable_balance',
        { p_merchant_id: merchant.id }
      );
      const spendableBalance =
        spendableRaw === null || spendableRaw === undefined
          ? Number.NaN
          : Number(spendableRaw);
      if (spendableError || !Number.isFinite(spendableBalance)) {
        results.failed++;
        results.details.push({
          merchantId: merchant.id,
          status: 'failed',
          error: 'Spendable balance unavailable',
        });
        continue;
      }
      const availableBalance = spendableBalance;

      // Skip if below minimum
      if (availableBalance < minPayoutAmount) {
        results.skipped++;
        results.details.push({
          merchantId: merchant.id,
          status: 'skipped',
          error: `Spendable balance ${availableBalance} below minimum ${minPayoutAmount}`,
        });
        continue;
      }

      // Skip if no bank details
      if (
        !merchant.bank_account_number ||
        !merchant.bank_code ||
        !merchant.bank_account_name
      ) {
        results.skipped++;
        results.details.push({
          merchantId: merchant.id,
          status: 'skipped',
          error: 'Missing bank details',
        });
        continue;
      }

      results.processed++;

      // Debit wallet
      const { data: debitResult, error: debitError } = await supabase.rpc(
        'debit_merchant_wallet',
        {
          p_merchant_id: merchant.id,
          p_amount: availableBalance,
          p_type: 'payout',
          p_description: `Weekly auto-payout - ${today}`,
        }
      );

      if (debitError || !debitResult?.[0]?.success) {
        results.failed++;
        results.details.push({
          merchantId: merchant.id,
          status: 'failed',
          error: debitResult?.[0]?.error_message || 'Debit failed',
        });
        continue;
      }

      const transactionId = debitResult[0].transaction_id;

      // Execute transfer
      let transferResult: Awaited<ReturnType<typeof payoutMerchantCommission>>;
      try {
        transferResult = await payoutMerchantCommission(
          {
            accountNumber: merchant.bank_account_number,
            bankCode: merchant.bank_code,
            accountName: merchant.bank_account_name,
          },
          availableBalance,
          merchant.id
        );
      } catch (transferError) {
        // Refund on error
        await supabase.rpc('complete_wallet_withdrawal', {
          p_transaction_id: transactionId,
          p_success: false,
          p_transfer_reference: null,
          p_transfer_message:
            transferError instanceof Error
              ? transferError.message
              : 'Transfer error',
        });

        results.failed++;
        results.details.push({
          merchantId: merchant.id,
          status: 'failed',
          amount: availableBalance,
          error:
            transferError instanceof Error
              ? transferError.message
              : 'Transfer error',
        });
        continue;
      }

      // Complete withdrawal
      await supabase.rpc('complete_wallet_withdrawal', {
        p_transaction_id: transactionId,
        p_success: transferResult.success,
        p_transfer_reference: transferResult.reference,
        p_transfer_message: transferResult.message,
      });

      if (transferResult.success) {
        results.successful++;
        results.details.push({
          merchantId: merchant.id,
          status: 'success',
          amount: availableBalance,
        });
      } else {
        results.failed++;
        results.details.push({
          merchantId: merchant.id,
          status: 'failed',
          amount: availableBalance,
          error: transferResult.message,
        });
      }
    }

    console.log('Weekly payout results:', results);

    return NextResponse.json({
      success: true,
      day: today,
      results,
    });
  } catch (error) {
    console.error('Weekly payout cron error:', error);
    return NextResponse.json({ error: 'Cron job failed' }, { status: 500 });
  }
}

// Support GET for manual fallback invocation.
export function GET(request: Request) {
  const secret = getCronSecret();
  if (!hasValidCronSecret(request.headers, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mockRequest = new Request(request.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  });

  return POST(mockRequest);
}
