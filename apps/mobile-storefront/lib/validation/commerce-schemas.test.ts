import { z } from 'zod';
import {
  CalculateOrderInput,
  CalculateVTUInput,
  getFirstError,
  ImeiCheckApiResponseSchema,
  ImeiResultSchema,
  isValidIMEI,
  QuantitySchema,
  ReviewSchema,
  ShippingAddressSchema,
  validateWithSchema,
} from './commerce-schemas';

const validShippingAddress = {
  email: 'customer@example.com',
  firstName: 'Tolu',
  lastName: 'Adebayo',
  phone: '08012345678',
  address: '42 Admiralty Way',
  city: 'Lagos',
  state: 'Lagos',
};

describe('ShippingAddressSchema', () => {
  it('accepts valid shipping address input', () => {
    expect(ShippingAddressSchema.safeParse(validShippingAddress).success).toBe(
      true
    );
  });

  it.each([
    '08012345678',
    '+2348012345678',
    '2348012345678',
    '8012345678',
    '080-1234-5678',
    '(080) 1234 5678',
  ])('accepts multiple valid Nigerian phone formats: %s', (phone) => {
    expect(
      ShippingAddressSchema.safeParse({
        ...validShippingAddress,
        phone,
      }).success
    ).toBe(true);
  });

  it('rejects invalid phone values', () => {
    expect(
      ShippingAddressSchema.safeParse({
        ...validShippingAddress,
        phone: '12345',
      }).success
    ).toBe(false);
  });

  it('rejects invalid values with useful messages', () => {
    const result = ShippingAddressSchema.safeParse({
      ...validShippingAddress,
      firstName: 'T0lu',
      city: 'L',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain('First name cannot contain numbers');
      expect(messages).toContain('City name must be at least 2 characters');
    }
  });
});

describe('QuantitySchema', () => {
  it('accepts valid quantity values', () => {
    expect(QuantitySchema.safeParse(1).success).toBe(true);
    expect(QuantitySchema.safeParse(99).success).toBe(true);
  });

  it('rejects invalid quantity values', () => {
    const tooLow = QuantitySchema.safeParse(0);
    const tooHigh = QuantitySchema.safeParse(100);

    expect(tooLow.success).toBe(false);
    expect(tooHigh.success).toBe(false);
    if (!tooLow.success) {
      expect(tooLow.error.issues[0]?.message).toBe(
        'Quantity must be at least 1'
      );
    }
    if (!tooHigh.success) {
      expect(tooHigh.error.issues[0]?.message).toBe('Maximum quantity is 99');
    }
  });
});

describe('isValidIMEI', () => {
  it('returns true for valid 15-digit IMEIs', () => {
    expect(isValidIMEI('490154203237518')).toBe(true);
    expect(isValidIMEI('356938035643809')).toBe(true);
  });

  it('returns false for invalid length or checksum', () => {
    expect(isValidIMEI('49015420323751')).toBe(false);
    expect(isValidIMEI('490154203237519')).toBe(false);
  });
});

describe('calculate schemas', () => {
  it('validates CalculateOrderInput boundaries', () => {
    expect(
      CalculateOrderInput.safeParse({
        subtotal: 1000,
        shippingFee: 0,
        taxRate: 0.075,
        assuranceFee: 0,
      }).success
    ).toBe(true);

    expect(CalculateOrderInput.safeParse({ subtotal: 0 }).success).toBe(false);
    expect(
      CalculateOrderInput.safeParse({ subtotal: 1000, taxRate: 1.5 }).success
    ).toBe(false);
  });

  it('validates CalculateVTUInput boundaries', () => {
    expect(
      CalculateVTUInput.safeParse({
        amount: 1000,
        provider: 'mtn',
        category: 'DATA',
        merchantSplit: 30,
      }).success
    ).toBe(true);

    expect(
      CalculateVTUInput.safeParse({
        amount: 5000,
        provider: 'EKEDC NG',
        category: 'ELECTRICITY',
      }).success
    ).toBe(true);

    expect(
      CalculateVTUInput.safeParse({
        amount: 1000,
        provider: 'mtn',
        merchantSplit: 120,
      }).success
    ).toBe(false);

    expect(
      CalculateVTUInput.safeParse({
        amount: 1000,
        provider: '',
      }).success
    ).toBe(false);
  });
});

describe('ImeiResultSchema', () => {
  const validImeiResult = {
    imei: '490154203237518',
    device: 'iPhone 13 Pro',
    modelNumber: 'A2638',
    status: 'Clean' as const,
    icloud: 'Off',
    icloudLock: 'Unlocked',
    simLock: 'Unlocked',
    blacklistStatus: 'Not Blacklisted',
    carrier: 'Unlocked',
    deviceImage: 'https://cdn.example.com/iphone13pro.jpg',
    score: 94,
    activationStatus: 'Activated',
    serialNumber: 'F2LDN12345',
    purchaseDate: '2025-09-22',
    purchaseCountry: 'United States',
    warranty: 'AppleCare+',
    refurbished: 'No',
    demoUnit: 'No',
    mdmStatus: 'OFF',
    miLockStatus: 'Unlocked',
    miLostStatus: 'Clean',
    deviceType: 'apple' as const,
    verdict: 'Safe to buy',
    verdictType: 'safe' as const,
  };

  it('preserves normalized identity and image matching metadata', () => {
    const deviceProfile = {
      version: 1,
      brand: 'Apple',
      model: 'iPhone 17 Pro Max',
      color: 'Silver',
      storage: '512GB',
      imageMatch: 'color',
    };
    expect(
      ImeiResultSchema.parse({ ...validImeiResult, deviceProfile })
        .deviceProfile
    ).toEqual(deviceProfile);
  });

  it('accepts valid payloads', () => {
    expect(ImeiResultSchema.safeParse(validImeiResult).success).toBe(true);
  });

  it('accepts payloads when extended API fields are omitted', () => {
    const {
      activationStatus: _activationStatus,
      serialNumber: _serialNumber,
      purchaseDate: _purchaseDate,
      purchaseCountry: _purchaseCountry,
      warranty: _warranty,
      refurbished: _refurbished,
      demoUnit: _demoUnit,
      mdmStatus: _mdmStatus,
      miLockStatus: _miLockStatus,
      miLostStatus: _miLostStatus,
      ...minimalImeiResult
    } = validImeiResult;

    expect(ImeiResultSchema.safeParse(minimalImeiResult).success).toBe(true);
  });

  it('rejects invalid payloads', () => {
    expect(
      ImeiResultSchema.safeParse({
        ...validImeiResult,
        status: 'UnknownStatus',
      }).success
    ).toBe(false);
  });

  it('accepts provider-formatted purchase dates', () => {
    expect(
      ImeiResultSchema.safeParse({
        ...validImeiResult,
        purchaseDate: '22/09/2025',
      }).success
    ).toBe(true);

    expect(
      ImeiResultSchema.safeParse({
        ...validImeiResult,
        purchaseDate: 'September 22, 2025',
      }).success
    ).toBe(true);
  });

  it('preserves new Petrock result fields', () => {
    const parsed = ImeiResultSchema.parse({
      ...validImeiResult,
      devicePhoto: 'https://cdn.example.com/device.jpg',
      esimCompatibility: 'Supported',
      financeStatus: 'Paid',
      knoxEnrollment: 'Not enrolled',
      soldBy: 'Samsung USA',
      wifiMac: '00:11:22:33:44:55',
    });

    expect(parsed).toMatchObject({
      esimCompatibility: 'Supported',
      financeStatus: 'Paid',
      knoxEnrollment: 'Not enrolled',
    });
  });

  it('accepts the additive async pending response shape', () => {
    expect(
      ImeiCheckApiResponseSchema.parse({
        lookupId: '11111111-1111-4111-8111-111111111111',
        pollAfterMs: 2000,
        status: 'pending',
        success: true,
      })
    ).toMatchObject({ status: 'pending', success: true });
  });
});

describe('ReviewSchema', () => {
  it('accepts required and optional fields', () => {
    expect(
      ReviewSchema.safeParse({
        id: 'review-1',
        rating: 5,
        customer_name: 'Ada',
        verified_purchase: true,
        created_at: '2026-03-17T00:00:00Z',
      }).success
    ).toBe(true);
  });

  it('rejects invalid ratings', () => {
    expect(
      ReviewSchema.safeParse({
        id: 'review-1',
        rating: 6,
        customer_name: 'Ada',
        verified_purchase: true,
        created_at: '2026-03-17T00:00:00Z',
      }).success
    ).toBe(false);

    expect(
      ReviewSchema.safeParse({
        id: 'review-2',
        rating: 0,
        customer_name: 'Ada',
        verified_purchase: true,
        created_at: '2026-03-17T00:00:00Z',
      }).success
    ).toBe(false);
  });
});

describe('validateWithSchema', () => {
  it('returns success data for valid input', () => {
    const result = validateWithSchema(
      ShippingAddressSchema,
      validShippingAddress
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('customer@example.com');
    }
  });

  it('returns errors map for invalid input', () => {
    const result = validateWithSchema(ShippingAddressSchema, {
      ...validShippingAddress,
      email: 'invalid-email',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.email).toBe('Please enter a valid email address');
    }
  });
});

describe('getFirstError', () => {
  it('returns null for successful parse result', () => {
    const parseResult = z.string().safeParse('ok');
    expect(getFirstError(parseResult)).toBeNull();
  });

  it('returns the first issue message for failed parse result', () => {
    const parseResult = z.string().min(3, 'Too short').safeParse('ab');
    expect(getFirstError(parseResult)).toBe('Too short');
  });
});
