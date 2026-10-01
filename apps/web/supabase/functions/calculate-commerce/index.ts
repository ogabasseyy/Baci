import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { calculateOrderTotals } from '../../../src/lib/checkout/calculate-order-totals.ts';
import { calculateLoyaltyRedemption } from '../../../src/lib/commerce-loyalty-redemption.ts';
import {
  getProviderVtuCommissionRate,
  normalizeVtuCommissionCategory,
} from '../../../src/lib/vtu-commission-rates.ts';

console.log('Hello from calculate-commerce!');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { action, data } = await req.json();
    let result = {};

    switch (action) {
      case 'calculate_vtu': {
        const {
          amount,
          provider,
          providerSource,
          category = 'AIRTIME',
          merchantSplit = 50,
        } = data;
        const { cap, rate } = getProviderVtuCommissionRate(
          String(provider ?? ''),
          normalizeVtuCommissionCategory(category),
          providerSource === 'kuda' || providerSource === 'monnify'
            ? providerSource
            : undefined
        );

        let totalCommission = amount * rate;
        if (cap && totalCommission > cap) {
          totalCommission = cap;
        }

        const merchantEarning = totalCommission * (merchantSplit / 100);
        const platformEarning = totalCommission - merchantEarning;

        result = {
          platformEarning: Math.round(platformEarning * 100) / 100,
          merchantEarning: Math.round(merchantEarning * 100) / 100,
          totalCommission: Math.round(totalCommission * 100) / 100,
          commissionRate: rate * 100,
        };
        break;
      }

      case 'calculate_order': {
        const { subtotal, taxRate = 0.075, shippingFee = 0 } = data;
        result = calculateOrderTotals({ subtotal, shippingFee, taxRate });
        break;
      }

      case 'redeem_loyalty': {
        result = calculateLoyaltyRedemption(data);
        break;
      }

      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
