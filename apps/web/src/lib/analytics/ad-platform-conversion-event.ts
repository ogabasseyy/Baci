import type { AdPlatformTarget } from './ad-platform-target';

export interface ConversionEvent {
  merchant_id: string;
  event_type: string;
  event_id: string;
  occurred_at?: string;
  limited_data_use?: boolean;
  user_data: {
    measurement_consent?: boolean;
    oppref?: string;
    obref?: string;
    city?: string;
    country?: string;
    email?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    external_id?: string;
    ip?: string;
    ua?: string;
    fbc?: string;
    fbp?: string;
    ttclid?: string;
    ttp?: string;
    sccid?: string;
    state?: string;
    zip_code?: string;
  };
  custom_data: {
    order_id?: string;
    value?: number;
    currency?: string;
    content_name?: string;
    content_type?: 'product' | 'product_group';
    price?: number;
    search_string?: string;
    url?: string;
    contents?: Array<{
      id: string;
      quantity: number;
      name?: string;
      price?: number;
    }>;
  };
  source: 'web' | 'mobile_app' | 'server';
  targets?: AdPlatformTarget[];
}

export type AdPlatformDeliveryOptions = { signal?: AbortSignal };
