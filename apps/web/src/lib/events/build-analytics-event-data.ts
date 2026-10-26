import { isConversionEvent } from '@/lib/analytics/is-conversion-event';
import type { AnalyticsEventRequest } from '@/schemas/analytics-event';
import { clientMarketingTargets } from './client-marketing-targets';

function assignDefined(
  target: Record<string, unknown>,
  key: string,
  value: unknown
): void {
  if (value !== undefined) target[key] = value;
}

export function buildAnalyticsEventData(
  input: AnalyticsEventRequest,
  eventType: string
): Record<string, unknown> {
  const eventData: Record<string, unknown> = {};
  if (isConversionEvent(eventType))
    eventData.targets = clientMarketingTargets({
      analytics: input.analytics_consent,
      marketing: input.marketing_consent,
    });
  assignDefined(eventData, 'session_id', input.session_id);
  assignDefined(eventData, 'user_agent', input.user_agent);
  assignDefined(eventData, 'referrer', input.referrer);
  assignDefined(eventData, 'page_url', input.page_url);

  if (
    [
      'product_view',
      'add_to_cart',
      'remove_from_cart',
      'add_to_wishlist',
    ].includes(eventType)
  ) {
    const contents = input.items ?? input.custom_data?.contents;
    assignDefined(eventData, 'product_id', input.product_id);
    assignDefined(eventData, 'product_name', input.product_name);
    assignDefined(eventData, 'product_category', input.product_category);
    assignDefined(
      eventData,
      'product_price',
      input.product_price ?? input.custom_data?.price
    );
    assignDefined(eventData, 'quantity', input.quantity);
    assignDefined(
      eventData,
      'currency',
      input.currency ?? input.custom_data?.currency
    );
    assignDefined(eventData, 'items', contents);
    assignDefined(eventData, 'total', input.total ?? input.custom_data?.value);
    if (input.custom_data) eventData.custom_data = input.custom_data;
    return eventData;
  }

  if (eventType === 'begin_checkout' || eventType === 'purchase') {
    const contents = input.items ?? input.custom_data?.contents;
    assignDefined(
      eventData,
      'order_id',
      input.order_id ?? input.custom_data?.order_id
    );
    assignDefined(eventData, 'total', input.total ?? input.custom_data?.value);
    assignDefined(eventData, 'subtotal', input.subtotal);
    assignDefined(eventData, 'shipping', input.shipping);
    assignDefined(eventData, 'tax', input.tax);
    eventData.currency = input.currency ?? input.custom_data?.currency ?? 'NGN';
    assignDefined(
      eventData,
      'item_count',
      input.item_count ?? contents?.length
    );
    assignDefined(eventData, 'items', contents);
    if (input.custom_data) eventData.custom_data = input.custom_data;
    return eventData;
  }

  if (eventType === 'search') {
    assignDefined(eventData, 'search_term', input.search_term);
    assignDefined(eventData, 'results_count', input.results_count);
    return eventData;
  }

  if (input.custom_data) eventData.custom_data = input.custom_data;
  return eventData;
}
