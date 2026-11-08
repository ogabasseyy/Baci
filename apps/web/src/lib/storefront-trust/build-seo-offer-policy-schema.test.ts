import { describe, expect, it } from 'vitest';
import {
  buildMerchantReturnPolicy,
  buildMerchantReturnPolicyFromTrustProfile,
  buildOfferShippingDetails,
  isValidShippingDayRange,
  mapReturnFeeToSchemaUrl,
  mapReturnMethodToSchemaUrl,
  toDeliveryDayRange,
} from './build-seo-offer-policy-schema';

describe('build-seo-offer-policy-schema', () => {
  describe('return schema mapping', () => {
    it('maps return methods to schema urls', () => {
      expect(mapReturnMethodToSchemaUrl('mail')).toBe(
        'https://schema.org/ReturnByMail'
      );
      expect(mapReturnMethodToSchemaUrl('carrier_dropoff')).toBe(
        'https://schema.org/ReturnByMail'
      );
      expect(mapReturnMethodToSchemaUrl('in_store')).toBe(
        'https://schema.org/ReturnInStore'
      );
      expect(mapReturnMethodToSchemaUrl(undefined)).toBeUndefined();
    });

    it('maps return fees to schema urls', () => {
      expect(mapReturnFeeToSchemaUrl('free')).toBe(
        'https://schema.org/FreeReturn'
      );
      expect(mapReturnFeeToSchemaUrl('customer_pays')).toBe(
        'https://schema.org/ReturnShippingFees'
      );
      expect(mapReturnFeeToSchemaUrl('original_shipping_deducted')).toBe(
        'https://schema.org/OriginalShippingFees'
      );
      expect(mapReturnFeeToSchemaUrl(undefined)).toBeUndefined();
    });

    it('returns undefined when windowDays is missing, non-integer, or negative', () => {
      expect(buildMerchantReturnPolicy('NG', undefined)).toBeUndefined();
      expect(
        buildMerchantReturnPolicy('NG', {
          socialLinks: {},
          derivedLinks: {},
        })
      ).toBeUndefined();
      expect(
        buildMerchantReturnPolicy('NG', {
          socialLinks: {},
          derivedLinks: {},
          returnPolicy: { localRoute: '/returns', windowDays: -1 },
        })
      ).toBeUndefined();
      expect(
        buildMerchantReturnPolicy('NG', {
          socialLinks: {},
          derivedLinks: {},
          returnPolicy: { localRoute: '/returns', windowDays: 1.5 },
        })
      ).toBeUndefined();
    });

    it('returns MerchantReturnNotPermitted when windowDays is 0', () => {
      const policy = buildMerchantReturnPolicy('NG', {
        socialLinks: {},
        derivedLinks: {},
        returnPolicy: { localRoute: '/returns', windowDays: 0 },
      });
      expect(policy).toEqual({
        '@type': 'MerchantReturnPolicy',
        applicableCountry: 'NG',
        returnPolicyCountry: 'NG',
        returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
      });
    });

    it('returns MerchantReturnFiniteReturnWindow with days, fees, and methods when windowDays > 0', () => {
      const policy = buildMerchantReturnPolicy('NG', {
        socialLinks: {},
        derivedLinks: {},
        returnPolicy: {
          localRoute: '/returns',
          windowDays: 14,
          returnMethod: 'mail',
          returnFees: 'free',
        },
      });
      expect(policy).toEqual({
        '@type': 'MerchantReturnPolicy',
        applicableCountry: 'NG',
        returnPolicyCountry: 'NG',
        returnPolicyCategory:
          'https://schema.org/MerchantReturnFiniteReturnWindow',
        merchantReturnDays: 14,
        returnMethod: 'https://schema.org/ReturnByMail',
        returnFees: 'https://schema.org/FreeReturn',
      });
    });

    it('exposes buildMerchantReturnPolicyFromTrustProfile alias identical to buildMerchantReturnPolicy', () => {
      expect(buildMerchantReturnPolicyFromTrustProfile).toBe(
        buildMerchantReturnPolicy
      );
    });
  });

  describe('shipping schema mapping', () => {
    it('validates shipping day ranges', () => {
      expect(isValidShippingDayRange(0, 1)).toBe(true);
      expect(isValidShippingDayRange(1, 1)).toBe(true);
      expect(isValidShippingDayRange(2, 5)).toBe(true);
      expect(isValidShippingDayRange(undefined, 1)).toBe(false);
      expect(isValidShippingDayRange(1, undefined)).toBe(false);
      expect(isValidShippingDayRange(-1, 2)).toBe(false);
      expect(isValidShippingDayRange(1.5, 2)).toBe(false);
      expect(isValidShippingDayRange(3, 1)).toBe(false);
    });

    it('constructs QuantitativeValue delivery day ranges', () => {
      expect(toDeliveryDayRange(1, 4)).toEqual({
        '@type': 'QuantitativeValue',
        minValue: 1,
        maxValue: 4,
        unitCode: 'DAY',
      });
    });

    it('returns undefined if shipping is not free', () => {
      expect(
        buildOfferShippingDetails('NG', 'NGN', {
          socialLinks: {},
          derivedLinks: {},
          shippingPolicy: {
            localRoute: '/shipping',
            regions: ['NG'],
            shippingFeeType: 'calculated',
            handlingDaysMin: 0,
            handlingDaysMax: 1,
            transitDaysMin: 1,
            transitDaysMax: 3,
          },
        })
      ).toBeUndefined();
    });

    it('returns undefined if region does not match target country', () => {
      expect(
        buildOfferShippingDetails('US', 'USD', {
          socialLinks: {},
          derivedLinks: {},
          shippingPolicy: {
            localRoute: '/shipping',
            regions: ['NG'],
            shippingFeeType: 'free',
            handlingDaysMin: 0,
            handlingDaysMax: 1,
            transitDaysMin: 1,
            transitDaysMax: 3,
          },
        })
      ).toBeUndefined();
    });

    it('returns undefined if handling or transit day ranges are invalid', () => {
      expect(
        buildOfferShippingDetails('NG', 'NGN', {
          socialLinks: {},
          derivedLinks: {},
          shippingPolicy: {
            localRoute: '/shipping',
            regions: ['NG'],
            shippingFeeType: 'free',
            handlingDaysMin: 2,
            handlingDaysMax: 1,
            transitDaysMin: 1,
            transitDaysMax: 3,
          },
        })
      ).toBeUndefined();
    });

    it('builds full OfferShippingDetails when shipping is free with matching region and valid timing', () => {
      const details = buildOfferShippingDetails('NG', 'NGN', {
        socialLinks: {},
        derivedLinks: {},
        shippingPolicy: {
          localRoute: '/shipping',
          regions: ['Nigeria', 'NG'],
          shippingFeeType: 'free',
          handlingDaysMin: 0,
          handlingDaysMax: 1,
          transitDaysMin: 1,
          transitDaysMax: 4,
        },
      });

      expect(details).toEqual({
        '@type': 'OfferShippingDetails',
        shippingRate: {
          '@type': 'MonetaryAmount',
          value: 0,
          currency: 'NGN',
        },
        shippingDestination: {
          '@type': 'DefinedRegion',
          addressCountry: 'NG',
        },
        deliveryTime: {
          '@type': 'ShippingDeliveryTime',
          handlingTime: {
            '@type': 'QuantitativeValue',
            minValue: 0,
            maxValue: 1,
            unitCode: 'DAY',
          },
          transitTime: {
            '@type': 'QuantitativeValue',
            minValue: 1,
            maxValue: 4,
            unitCode: 'DAY',
          },
        },
      });
    });
  });
});
