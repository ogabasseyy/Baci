import {
  getAirtimeCustomerName,
  nextPhoneDigits,
  phoneLengthError,
  resolveAirtimeProvider,
  sanitizeAirtimeAmountInput,
  sanitizePhoneDigits,
  validateAirtimePurchaseInput,
} from './airtime-form-controller.helpers';

describe('airtime-form-controller.helpers', () => {
  it('normalizes phone and amount inputs', () => {
    // The local form, so the field holds one 11-digit number (Fable).
    expect(sanitizePhoneDigits('+234 (803) 123-4567')).toBe('08031234567');
    expect(sanitizeAirtimeAmountInput('₦12,500.90')).toBe('1250090');
  });

  it('resolves provider from detected prefixes', () => {
    expect(resolveAirtimeProvider('08031234567')).toBe('mtn');
    expect(resolveAirtimeProvider('')).toBeNull();
    expect(resolveAirtimeProvider('00000000000')).toBeNull();
  });

  it('validates airtime purchase preconditions', () => {
    expect(
      validateAirtimePurchaseInput({
        amount: '',
        numericAmount: 0,
        phoneNumber: '',
        selectedProvider: null,
      })
    ).toEqual({
      title: 'Missing Information',
      message: 'Please fill in all fields.',
    });

    expect(
      validateAirtimePurchaseInput({
        amount: '40',
        numericAmount: 40,
        phoneNumber: '08031234567',
        selectedProvider: 'mtn',
      })
    ).toEqual({
      title: 'Invalid Amount',
      message: 'Amount must be between ₦50 and ₦50,000.',
    });

    // Wallet is the only payment method: a complete form always validates.
    expect(
      validateAirtimePurchaseInput({
        amount: '500',
        numericAmount: 500,
        phoneNumber: '08031234567',
        selectedProvider: 'mtn',
      })
    ).toBeNull();
  });

  it('builds customer names with sensible fallback order', () => {
    expect(
      getAirtimeCustomerName({
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'jane@example.com',
      })
    ).toBe('Jane Doe');
    expect(getAirtimeCustomerName({ email: 'jane@example.com' })).toBe(
      'jane@example.com'
    );
    expect(getAirtimeCustomerName(null)).toBe('Customer');
  });
});

describe('bugfix: the phone field took 18 digits (Fable)', () => {
  it('ignores typing past a complete 11-digit number', () => {
    expect(nextPhoneDigits('08012345678', '080123456789')).toBe('08012345678');
    expect(nextPhoneDigits('0801234567', '08012345678')).toBe('08012345678');
  });

  it('turns a pasted +234 number into its local form', () => {
    expect(sanitizePhoneDigits('+234 801 234 5678')).toBe('08012345678');
    expect(nextPhoneDigits('', '2348012345678')).toBe('08012345678');
  });
});

describe('bugfix: an overlong number was cut and sent to someone else (Muse)', () => {
  it('keeps an overlong paste as entered, and the purchase check refuses it', () => {
    const pasted = nextPhoneDigits('', '080123456789999999');
    expect(pasted).toBe('080123456789999999');
    expect(phoneLengthError(pasted)).toMatchObject({
      title: 'Check the phone number',
    });
    expect(
      validateAirtimePurchaseInput({
        amount: '100',
        numericAmount: 100,
        phoneNumber: pasted,
        selectedProvider: 'mtn',
      })
    ).toMatchObject({ title: 'Check the phone number' });
    expect(phoneLengthError('08012345678')).toBeNull();
  });
});
