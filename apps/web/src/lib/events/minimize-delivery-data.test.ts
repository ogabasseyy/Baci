import { describe, expect, it } from 'vitest';
import {
  type DeliveryData,
  minimizeDeliveryData,
} from './minimize-delivery-data';

const full = (analytics: boolean, marketing: boolean): DeliveryData => ({
  analytics_consent: analytics,
  marketing_consent: marketing,
  email: 'a@example.com',
  external_id: 'ext-1',
  fbc: 'fb.1.click',
  fbp: 'fbp.1',
  ip: '203.0.113.1',
  phone: '+2348000000000',
  sccid: 'snap.1',
  ttclid: 'tt.1',
  ttp: 'ttp.1',
  ua: 'Agent',
});

describe('bugfix: shopper data stored regardless of consent', () => {
  it('keeps only the consent flags for a no-consent page view', () => {
    expect(minimizeDeliveryData(full(false, false), 'page_view')).toEqual({
      analytics_consent: false,
      marketing_consent: false,
    });
  });

  it('keeps only the consent flags for a no-consent conversion event', () => {
    expect(minimizeDeliveryData(full(false, false), 'add_to_cart')).toEqual({
      analytics_consent: false,
      marketing_consent: false,
    });
  });

  it('drops personal fields from a consented event no ad platform consumes', () => {
    expect(minimizeDeliveryData(full(true, true), 'page_view')).toEqual({
      analytics_consent: true,
      marketing_consent: true,
    });
  });

  it('keeps every field for a consented conversion event', () => {
    const data = full(true, false);
    expect(minimizeDeliveryData(data, 'begin_checkout')).toEqual(data);
  });

  it('keeps every field when only marketing consent is granted', () => {
    const data = full(false, true);
    expect(minimizeDeliveryData(data, 'purchase')).toEqual(data);
  });
});
