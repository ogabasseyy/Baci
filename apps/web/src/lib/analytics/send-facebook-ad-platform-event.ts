import {
  type FacebookEventName,
  facebookCAPI,
  sendFacebookCAPIEvent,
} from '@/lib/facebook-capi';
import type { ConversionEvent } from './ad-platform-conversion-event';
import { toAdPlatformProducts } from './ad-platform-products';
import type { AnalyticsPlatformConfig } from './analytics-platform-config-types';

export async function sendFacebookAdPlatformEvent(
  config: Readonly<AnalyticsPlatformConfig>,
  event: ConversionEvent,
  eventName: FacebookEventName,
  signal?: AbortSignal
): Promise<{ success: boolean; error?: string }> {
  if (!config.facebook_pixel_id || !config.facebook_capi_token) {
    return { success: false, error: 'not_configured' };
  }
  const userData = {
    city: event.user_data.city,
    country: event.user_data.country,
    email: event.user_data.email,
    firstName: event.user_data.first_name,
    lastName: event.user_data.last_name,
    phone: event.user_data.phone,
    externalId: event.user_data.external_id,
    clientIpAddress: event.user_data.ip,
    clientUserAgent: event.user_data.ua,
    fbc: event.user_data.fbc,
    fbp: event.user_data.fbp,
    state: event.user_data.state,
    zipCode: event.user_data.zip_code,
  };
  const { facebook_pixel_id: pixel, facebook_capi_token: token } = config;
  const currency = event.custom_data.currency || 'NGN';
  const value = event.custom_data.value || 0;
  const contents = event.custom_data.contents || [];
  const first = contents[0];
  const url = event.custom_data.url;
  const parsedTime = event.occurred_at
    ? Date.parse(event.occurred_at)
    : Number.NaN;
  const eventTime =
    Number.isFinite(parsedTime) && parsedTime > 0
      ? Math.floor(parsedTime / 1_000)
      : undefined;
  if (eventName === 'Purchase') {
    return value && contents.length
      ? await facebookCAPI.purchase(
          pixel,
          token,
          userData,
          event.custom_data.order_id || event.event_id,
          value,
          currency,
          toAdPlatformProducts(contents),
          url,
          event.event_id,
          event.limited_data_use,
          signal,
          eventTime
        )
      : { success: false, error: 'missing_purchase_data' };
  }
  if (eventName === 'InitiateCheckout') {
    return await facebookCAPI.initiateCheckout(
      pixel,
      token,
      userData,
      value,
      currency,
      contents,
      url,
      event.event_id,
      signal,
      eventTime,
      event.limited_data_use
    );
  }
  if (eventName === 'AddToCart') {
    return first
      ? await facebookCAPI.addToCart(
          pixel,
          token,
          userData,
          first.id,
          first.name || first.id,
          value,
          currency,
          url,
          event.event_id,
          signal,
          eventTime,
          event.limited_data_use
        )
      : { success: false, error: 'missing_cart_data' };
  }
  if (eventName === 'ViewContent') {
    return first
      ? await facebookCAPI.viewContent(
          pixel,
          token,
          userData,
          first.id,
          first.name || first.id,
          value,
          currency,
          undefined,
          url,
          event.event_id,
          signal,
          eventTime,
          event.limited_data_use
        )
      : { success: false, error: 'missing_content_data' };
  }
  if (eventName === 'Search' && !event.custom_data.search_string) {
    return { success: false, error: 'missing_search_data' };
  }
  if (
    ![
      'Search',
      'AddPaymentInfo',
      'AddToWishlist',
      'CompleteRegistration',
    ].includes(eventName)
  ) {
    return { success: false, error: `unmapped_event: ${eventName}` };
  }
  return await sendFacebookCAPIEvent(
    pixel,
    token,
    eventName,
    userData,
    eventName === 'Search'
      ? {
          contentIds: contents.map((item) => item.id),
          currency,
          searchString: event.custom_data.search_string,
          contentType: 'product_group',
          value,
        }
      : {
          contentIds: contents.map((item) => item.id),
          contentName:
            event.custom_data.content_name || first?.name || first?.id,
          contentType: 'product_group',
          currency,
          value,
        },
    url,
    event.event_id,
    event.limited_data_use,
    signal,
    eventTime
  );
}
