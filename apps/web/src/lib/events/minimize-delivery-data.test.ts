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
    expect(
      minimizeDeliveryData(
        full(false, false),
        'page_view',
        'tenant_verified_client'
      )
    ).toEqual({
      analytics_consent: false,
      marketing_consent: false,
    });
  });

  it('keeps only the consent flags for a no-consent conversion event', () => {
    expect(
      minimizeDeliveryData(
        full(false, false),
        'add_to_cart',
        'tenant_verified_client'
      )
    ).toEqual({
      analytics_consent: false,
      marketing_consent: false,
    });
  });

  it('drops personal fields from a consented event no ad platform consumes', () => {
    expect(
      minimizeDeliveryData(
        full(true, true),
        'page_view',
        'tenant_verified_client'
      )
    ).toEqual({
      analytics_consent: true,
      marketing_consent: true,
    });
  });

  it('keeps every field when both consents are granted on a conversion event', () => {
    const data = full(true, true);
    expect(
      minimizeDeliveryData(data, 'begin_checkout', 'tenant_verified_client')
    ).toEqual(data);
  });

  it('drops TikTok and Snapchat ids when only analytics consent is granted', () => {
    const result = minimizeDeliveryData(
      full(true, false),
      'begin_checkout',
      'tenant_verified_client'
    );
    expect(result).toMatchObject({
      fbp: 'fbp.1',
      fbc: 'fb.1.click',
      ip: '203.0.113.1',
    });
    expect(result).not.toHaveProperty('ttp');
    expect(result).not.toHaveProperty('ttclid');
    expect(result).not.toHaveProperty('sccid');
  });

  it('drops Facebook cookie ids when only marketing consent is granted', () => {
    const result = minimizeDeliveryData(
      full(false, true),
      'search',
      'tenant_verified_client'
    );
    expect(result).toMatchObject({
      ttp: 'ttp.1',
      ttclid: 'tt.1',
      sccid: 'snap.1',
      ip: '203.0.113.1',
    });
    expect(result).not.toHaveProperty('fbp');
    expect(result).not.toHaveProperty('fbc');
  });

  it('drops personal fields for client purchase, which has no destination', () => {
    expect(
      minimizeDeliveryData(
        full(true, true),
        'purchase',
        'tenant_verified_client'
      )
    ).toEqual({ analytics_consent: true, marketing_consent: true });
  });

  it('drops personal fields for place_order, which has no client destination', () => {
    expect(
      minimizeDeliveryData(
        full(true, true),
        'place_order',
        'tenant_verified_client'
      )
    ).toEqual({ analytics_consent: true, marketing_consent: true });
  });

  it('drops personal fields for anonymous clients, which never deliver', () => {
    expect(
      minimizeDeliveryData(full(true, true), 'add_to_cart', 'anonymous_client')
    ).toEqual({ analytics_consent: true, marketing_consent: true });
  });

  describe('bugfix: explicit conversion targets narrow what is stored', () => {
    it('keeps only the Facebook ids when only facebook is targeted, even with both consents', () => {
      const result = minimizeDeliveryData(
        full(true, true),
        'add_to_cart',
        'tenant_verified_client',
        ['facebook']
      );
      expect(result).toHaveProperty('fbp');
      expect(result).toHaveProperty('email');
      expect(result).not.toHaveProperty('ttp');
      expect(result).not.toHaveProperty('sccid');
    });

    it('stores only the consent flags when the target list is empty', () => {
      expect(
        minimizeDeliveryData(
          full(true, true),
          'add_to_cart',
          'tenant_verified_client',
          []
        )
      ).toEqual({ analytics_consent: true, marketing_consent: true });
    });
  });
});
