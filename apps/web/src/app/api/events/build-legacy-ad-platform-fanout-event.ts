import type { NextRequest } from 'next/server';
import type { ConversionEvent } from '@/lib/analytics/send-to-ad-platforms';
import { clientMarketingTargets } from '@/lib/events/client-marketing-targets';
import type { AnalyticsEventRequest } from '@/schemas/analytics-event';

function conversionContents(input: AnalyticsEventRequest) {
  const items = input.items ?? input.custom_data?.contents ?? [];
  return items.flatMap((item) => {
    const id = item.id ?? item.product_id;
    return id
      ? [
          {
            id,
            name: item.name ?? item.product_name,
            price: item.price,
            quantity: item.quantity,
          },
        ]
      : [];
  });
}

export function buildLegacyAdPlatformFanoutEvent(input: {
  eventId: string;
  eventType: string;
  input: AnalyticsEventRequest;
  request: NextRequest;
  resolvedMerchantId: string;
}): ConversionEvent {
  const contents = conversionContents(input.input);
  return {
    custom_data: {
      content_name:
        input.input.product_name ?? input.input.custom_data?.content_name,
      content_type: input.input.custom_data?.content_type ?? 'product',
      contents:
        contents.length > 0
          ? contents
          : input.input.product_id
            ? [
                {
                  id: input.input.product_id,
                  name: input.input.product_name,
                  price: input.input.product_price,
                  quantity: input.input.quantity ?? 1,
                },
              ]
            : undefined,
      currency:
        input.input.currency ?? input.input.custom_data?.currency ?? 'NGN',
      order_id: input.input.order_id ?? input.input.custom_data?.order_id,
      price: input.input.product_price ?? input.input.custom_data?.price,
      search_string:
        input.input.search_term ?? input.input.custom_data?.search_string,
      url: input.input.page_url ?? input.input.custom_data?.url,
      value:
        input.input.total ??
        input.input.custom_data?.value ??
        input.input.product_price,
    },
    event_id: input.eventId,
    event_type: input.eventType,
    merchant_id: input.resolvedMerchantId,
    source: input.input.source ?? 'web',
    targets: clientMarketingTargets({
      analytics: input.input.analytics_consent,
      marketing: input.input.marketing_consent,
    }),
    user_data: {
      analytics_consent: input.input.analytics_consent === true,
      marketing_consent: input.input.marketing_consent === true,
      email: input.input.user_data?.em,
      external_id: input.input.user_data?.external_id,
      fbc:
        input.input.user_data?.fbc ?? input.request.cookies.get('_fbc')?.value,
      fbp:
        input.input.user_data?.fbp ?? input.request.cookies.get('_fbp')?.value,
      ip:
        input.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        input.request.headers.get('x-real-ip') ??
        undefined,
      phone: input.input.user_data?.ph,
      sccid:
        input.input.user_data?.sccid ??
        input.request.cookies.get('ScCid')?.value,
      ttclid: input.input.user_data?.ttclid,
      ttp:
        input.input.user_data?.ttp ?? input.request.cookies.get('_ttp')?.value,
      ua: input.request.headers.get('user-agent') ?? undefined,
    },
  };
}
