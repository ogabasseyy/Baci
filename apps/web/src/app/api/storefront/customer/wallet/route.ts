/**
 * Customer Wallet API
 * GET /api/storefront/customer/wallet - Get customer's wallet balance and recent transactions
 *
 * 2025 Best Practices:
 * - Progressive disclosure: Only show wallet if balance > 0
 * - Real-time balance for checkout
 * - Transaction history for transparency
 */

import { NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import {
  fetchCustomerWallet,
  getCustomerSavingsEarnings,
  getFundingAccount,
  getSavingsBalance,
  getUsdtBalance,
} from './wallet-data';
import {
  emptyWalletResponse,
  logOptionalWalletHelperFailure,
  toNumber,
} from './wallet-data-helpers';

interface CustomerWalletOwner {
  id: string;
  loyalty_points: number | string | null;
}

export async function GET(request: Request) {
  try {
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) {
      return NextResponse.json(
        { error: 'Unauthorized', balance: 0, transactions: [] },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const merchantSlug = searchParams.get('merchant');

    if (!merchantSlug) {
      return NextResponse.json(
        { error: 'Merchant slug is required' },
        { status: 400 }
      );
    }

    const { supabase, user } = auth;

    // Get merchant
    const { data: merchant, error: merchantError } = await supabase
      .from('merchants')
      .select('id')
      .eq('slug', merchantSlug)
      .single();

    if (merchantError || !merchant) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    // Whether this merchant offers wallet bank-transfer (DVA) funding. Lets
    // the client hide the "Pay with Bank Transfer" CTA when it would only
    // route to a DVA_DISABLED dead end. Read via the SECURITY DEFINER
    // storefront-settings RPC — a direct merchant_feature_settings SELECT is
    // RLS-restricted to merchant staff, so it returns no row for customers.
    const { data: storefrontPaymentSettings, error: paymentSettingsError } =
      await supabase.rpc('get_storefront_payment_settings', {
        p_merchant_id: merchant.id,
      });
    if (paymentSettingsError) {
      // Fail soft (walletDvaEnabled stays false), but log so an RPC outage is
      // distinguishable from a merchant genuinely having DVA disabled.
      console.error('Customer wallet optional fetch failed', {
        error: paymentSettingsError,
        label: 'storefront payment settings',
      });
    }
    const paymentSettingsRow = Array.isArray(storefrontPaymentSettings)
      ? storefrontPaymentSettings[0]
      : storefrontPaymentSettings;
    const walletDvaEnabled =
      paymentSettingsRow?.wallet_paystack_dva_enabled === true;

    // Get customer record for this user + merchant
    // Try by user_id first, then fallback to email (guest customers may not have user_id linked)
    let customer: CustomerWalletOwner | null = null;

    // First try by user_id (for customers who registered/logged in)
    const { data: customerByUserId } = await supabase
      .from('customers')
      .select('id, loyalty_points')
      .eq('merchant_id', merchant.id)
      .eq('user_id', user.id)
      .single();

    if (customerByUserId) {
      customer = customerByUserId;
    } else if (user.email) {
      // Fallback: try by email (for customers created as guests who later logged in)
      // Keep this GET read-only. Customer user_id linkage is owned by the
      // storefront auth session upsert flow, not by wallet reads.
      const { data: customerByEmail } = await supabase
        .from('customers')
        .select('id, loyalty_points')
        .eq('merchant_id', merchant.id)
        .eq('email', user.email)
        .single();

      if (customerByEmail) {
        customer = customerByEmail;
      }
    }

    const savingsEarnings = await getCustomerSavingsEarnings({
      merchantId: merchant.id,
      supabase,
    });

    if (!customer) {
      // Customer doesn't exist yet - return zero balance. No customer row
      // means account creation would fail ("Customer not found"), so never
      // advertise the funding consent CTA for this response.
      return NextResponse.json(
        emptyWalletResponse({
          ...savingsEarnings,
          requiresFundingAccountConsent: false,
          walletDvaEnabled,
        })
      );
    }

    const loyaltyPoints = toNumber(customer.loyalty_points);
    const [savingsBalanceResult, fundingAccountResult, usdtBalanceResult] =
      await Promise.allSettled([
        getSavingsBalance({
          customerId: customer.id,
          merchantId: merchant.id,
          supabase,
        }),
        getFundingAccount({
          customerId: customer.id,
          merchantId: merchant.id,
          supabase,
        }),
        getUsdtBalance({
          customerId: customer.id,
          merchantId: merchant.id,
          supabase,
        }),
      ]);
    const savingsBalance =
      savingsBalanceResult.status === 'fulfilled'
        ? savingsBalanceResult.value
        : 0;
    const fundingAccount =
      fundingAccountResult.status === 'fulfilled'
        ? fundingAccountResult.value
        : null;
    const usdtBalance =
      usdtBalanceResult.status === 'fulfilled' ? usdtBalanceResult.value : 0;
    logOptionalWalletHelperFailure('savings balance', savingsBalanceResult);
    logOptionalWalletHelperFailure('funding account', fundingAccountResult);
    logOptionalWalletHelperFailure('USDT balance', usdtBalanceResult);

    // Wallet balance + baseline transactions. `fetchCustomerWallet` fails LOUD
    // (kind: 'error') on any real failure so the funding check loop is never
    // handed a spuriously-empty baseline — see that helper's contract.
    const walletFetch = await fetchCustomerWallet({
      customerId: customer.id,
      merchantId: merchant.id,
      supabase,
    });

    if (walletFetch.kind === 'error') {
      return NextResponse.json(
        { error: 'Failed to fetch wallet', balance: 0, transactions: [] },
        { status: 500 }
      );
    }

    if (walletFetch.kind === 'no-wallet') {
      return NextResponse.json(
        emptyWalletResponse({
          ...savingsEarnings,
          fundingAccount,
          loyaltyPoints,
          savingsBalance,
          usdtBalance,
          walletDvaEnabled,
        })
      );
    }

    return NextResponse.json({
      balance: walletFetch.availableBalance,
      balances: {
        NGN: walletFetch.availableBalance,
        USDT: usdtBalance,
      },
      ...savingsEarnings,
      fundingAccount,
      loyaltyPoints,
      requiresFundingAccountConsent: !fundingAccount,
      savingsBalance,
      totalEarned: walletFetch.totalEarned,
      totalRedeemed: walletFetch.totalRedeemed,
      transactions: walletFetch.transactions,
      walletDvaEnabled,
      hasWallet: true,
    });
  } catch (error) {
    console.error('Customer wallet fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch wallet', balance: 0, transactions: [] },
      { status: 500 }
    );
  }
}
