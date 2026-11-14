import { stripProviderNames } from '@baci/shared/lib';
import { type NextRequest, NextResponse } from 'next/server';
import { getBillerCategories } from '@/lib/monnify-bills';
import { billersQuerySchema } from '@/schemas/vtu';
import {
  type BillersResponsePayload,
  getMonnifyCategoryCode,
  type NormalizedBiller,
  type NormalizedBillItem,
} from './biller-normalizers';
import {
  getErrorMessage,
  loadKudaBillers,
  loadMonnifyBillers,
} from './biller-route-helpers';
import { dedupeElectricityBillers } from './dedupe-electricity-billers';

// Plans can nest (Kuda bill items carry their own billItems): strip every level.
function withoutProviderNames(item: NormalizedBillItem): NormalizedBillItem {
  return {
    ...item,
    itemName: stripProviderNames(item.itemName) || 'Plan',
    billItems: item.billItems?.map(withoutProviderNames),
  };
}

// Customers never see provider names or provider error text; details are logged.
const BILLERS_UNAVAILABLE =
  "We couldn't load billers right now. Please try again.";
const SOME_BILLERS_MISSING =
  "Some billers couldn't be loaded right now. Please try again shortly.";

/**
 * GET /api/vtu/billers?type=electricity
 * Returns available billers/providers for a given bill category.
 * Public endpoint — customers need to see billers before purchasing.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = billersQuerySchema.safeParse({
      type: searchParams.get('type'),
      includeMonnify: searchParams.get('includeMonnify') ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Invalid bill type',
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const type = parsed.data.type;
    const includeMonnify = parsed.data.includeMonnify;
    const monnifyCategory = includeMonnify
      ? getMonnifyCategoryCode(type)
      : undefined;

    // TEMP DIAGNOSTIC: log the authoritative Monnify biller-categories list
    // (codes/names only, no PII) to confirm which head categories Monnify
    // actually supports. Gated behind an explicit query flag so normal billers
    // requests take ZERO extra latency — only a manual probe call triggers it.
    // Remove once answered.
    if (includeMonnify && searchParams.get('_probeCategories') === '1') {
      try {
        const monnifyCategories = await getBillerCategories();
        console.log(
          '[monnify-bills] biller-categories:',
          JSON.stringify(monnifyCategories)
        );
      } catch (categoriesError) {
        console.log(
          '[monnify-bills] biller-categories error:',
          categoriesError instanceof Error
            ? categoriesError.message
            : String(categoriesError)
        );
      }
    }

    const [{ billers: kudaBillers, error: kudaError }, monnifyResult] =
      await Promise.all([
        loadKudaBillers(type),
        monnifyCategory
          ? loadMonnifyBillers({ monnifyCategory, type })
          : Promise.resolve({ billers: [], error: null }),
      ]);

    const monnifyBillers = monnifyResult.billers;
    const monnifyError = monnifyResult.error;
    // Electricity: collapse to Kuda's cards and fold the matching Monnify pre/post
    // codes onto each Kuda bill item (Kuda display + Monnify fulfillment), so the
    // list shows one clean card per DISCO instead of Kuda+Monnify duplicates.
    let mergedBillers: NormalizedBiller[];
    if (type === 'electricity' && monnifyBillers.length > 0) {
      const { billers, matchedMonnifyProducts } = dedupeElectricityBillers(
        kudaBillers,
        monnifyBillers
      );
      // Prune folded products from each Monnify card; drop a card only once it
      // has no products left (keeps unmatched/unclassifiable meter types visible).
      const leftoverMonnify = monnifyBillers.flatMap((biller) => {
        const folded = biller.billerCode
          ? matchedMonnifyProducts.get(biller.billerCode)
          : undefined;
        if (!folded || folded.size === 0) {
          return [biller];
        }
        const remaining = (biller.billItems ?? []).filter(
          (item) => !(item.productCode && folded.has(item.productCode))
        );
        // No items left (incl. single-product billers with no nested items) → drop.
        if (remaining.length === 0) {
          return [];
        }
        return [{ ...biller, billItems: remaining }];
      });
      mergedBillers = [...billers, ...leftoverMonnify];
    } else {
      mergedBillers = [...kudaBillers, ...monnifyBillers];
    }

    if (mergedBillers.length === 0) {
      const providerError = kudaError ?? monnifyError;
      if (providerError) {
        console.error('Failed to fetch billers:', {
          kudaError: getErrorMessage(kudaError),
          monnifyError: getErrorMessage(monnifyError),
        });
        return NextResponse.json(
          { error: BILLERS_UNAVAILABLE, code: 'BILLERS_UNAVAILABLE' },
          { status: 500 }
        );
      }
    }

    // Biller and plan names come from the providers verbatim (e.g. "Ikeja
    // Electric (Kuda)"); customers never see the provider in them.
    const payload: BillersResponsePayload = {
      billers: mergedBillers.map((biller) => ({
        ...biller,
        billerName: stripProviderNames(biller.billerName) || 'Biller',
        billItems: biller.billItems?.map(withoutProviderNames),
      })),
    };
    // Older clients read these fields as the message to show, so they carry
    // neutral text; the provider detail only goes to the server log.
    if (kudaBillers.length === 0 && kudaError) {
      console.error('Billers partially unavailable:', kudaError.message);
      payload.kudaError = SOME_BILLERS_MISSING;
    }
    if (monnifyCategory && monnifyBillers.length === 0 && monnifyError) {
      console.error('Billers partially unavailable:', monnifyError.message);
      payload.monnifyError = SOME_BILLERS_MISSING;
    }

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to fetch billers:', message, error);
    return NextResponse.json(
      { error: BILLERS_UNAVAILABLE, code: 'BILLERS_UNAVAILABLE' },
      { status: 500 }
    );
  }
}
