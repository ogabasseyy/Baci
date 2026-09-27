import { facebookCAPIHelpers } from './facebook-capi-helpers';
import { sendFacebookCAPIEvent } from './facebook-capi-request';
import type { FacebookUserData } from './facebook-capi-types';

export { sendFacebookCAPIEvent } from './facebook-capi-request';
export type {
  FacebookCustomData,
  FacebookEventName,
  FacebookUserData,
} from './facebook-capi-types';

export const generateEventId = facebookCAPIHelpers.generateEventId;

export const facebookCAPI = {
  purchase: (
    pixelId: string,
    accessToken: string,
    userData: FacebookUserData,
    orderId: string,
    value: number,
    currency: string,
    products: Array<{
      id: string;
      name: string;
      quantity: number;
      price: number;
    }>,
    eventSourceUrl?: string,
    eventId?: string,
    limitedDataUse?: boolean,
    signal?: AbortSignal,
    eventTime?: number
  ) =>
    sendFacebookCAPIEvent(
      pixelId,
      accessToken,
      'Purchase',
      userData,
      {
        value,
        currency,
        orderId,
        contentType: 'product_group',
        contentIds: products.map((product) => product.id),
        contents: products.map((product) => ({
          id: product.id,
          quantity: product.quantity,
          item_price: product.price,
        })),
        numItems: products.reduce(
          (total, product) => total + product.quantity,
          0
        ),
      },
      eventSourceUrl,
      eventId,
      limitedDataUse,
      signal,
      eventTime
    ),

  initiateCheckout: (
    pixelId: string,
    accessToken: string,
    userData: FacebookUserData,
    value: number,
    currency: string,
    products: Array<{ id: string; quantity: number }>,
    eventSourceUrl?: string,
    eventId?: string,
    signal?: AbortSignal,
    eventTime?: number,
    limitedDataUse?: boolean
  ) =>
    sendFacebookCAPIEvent(
      pixelId,
      accessToken,
      'InitiateCheckout',
      userData,
      {
        value,
        currency,
        contentType: 'product_group',
        contentIds: products.map((product) => product.id),
        numItems: products.reduce(
          (total, product) => total + product.quantity,
          0
        ),
      },
      eventSourceUrl,
      eventId,
      limitedDataUse,
      signal,
      eventTime
    ),

  addToCart: (
    pixelId: string,
    accessToken: string,
    userData: FacebookUserData,
    productId: string,
    productName: string,
    value: number,
    currency: string,
    eventSourceUrl?: string,
    eventId?: string,
    signal?: AbortSignal,
    eventTime?: number,
    limitedDataUse?: boolean
  ) =>
    sendFacebookCAPIEvent(
      pixelId,
      accessToken,
      'AddToCart',
      userData,
      {
        value,
        currency,
        contentName: productName,
        contentType: 'product_group',
        contentIds: [productId],
      },
      eventSourceUrl,
      eventId,
      limitedDataUse,
      signal,
      eventTime
    ),

  viewContent: (
    pixelId: string,
    accessToken: string,
    userData: FacebookUserData,
    productId: string,
    productName: string,
    value: number,
    currency: string,
    category?: string,
    eventSourceUrl?: string,
    eventId?: string,
    signal?: AbortSignal,
    eventTime?: number,
    limitedDataUse?: boolean
  ) =>
    sendFacebookCAPIEvent(
      pixelId,
      accessToken,
      'ViewContent',
      userData,
      {
        value,
        currency,
        contentName: productName,
        contentCategory: category,
        contentType: 'product_group',
        contentIds: [productId],
      },
      eventSourceUrl,
      eventId,
      limitedDataUse,
      signal,
      eventTime
    ),
};
