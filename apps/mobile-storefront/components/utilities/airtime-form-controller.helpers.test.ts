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

describe('bugfix: fast input pushed the phone field past 11 digits (Fable walks 13, 14)', () => {
  it('never holds more than 11 digits, however the text arrives', () => {
    // A burst of late text: "0803123" then "456789" at once.
    expect(nextPhoneDigits('0803123', '0803123456789').digits).toBe(
      '08031234567'
    );
    // Delete two, type one straight away.
    expect(nextPhoneDigits('08031234567', '080312345678').digits).toBe(
      '08031234567'
    );
  });

  it('ignores one keystroke past a full number quietly, like a maximum length', () => {
    expect(nextPhoneDigits('08012345678', '080123456789')).toEqual({
      digits: '08012345678',
      trimmed: false,
    });
  });

  it('turns a pasted +234 number into its local form', () => {
    expect(sanitizePhoneDigits('+234 801 234 5678')).toBe('08012345678');
    expect(nextPhoneDigits('', '2348012345678')).toEqual({
      digits: '08012345678',
      trimmed: false,
    });
  });
});

describe('bugfix: an overlong number was cut silently (Muse)', () => {
  it('says so when a paste or burst loses digits', () => {
    expect(nextPhoneDigits('', '080123456789999999')).toEqual({
      digits: '08012345678',
      trimmed: true,
    });
    expect(nextPhoneDigits('0803123', '0803123456789').trimmed).toBe(true);
  });

  it('still refuses a number that is not 11 digits at purchase', () => {
    expect(
      validateAirtimePurchaseInput({
        amount: '100',
        numericAmount: 100,
        phoneNumber: '080123',
        selectedProvider: 'mtn',
      })
    ).toMatchObject({ title: 'Check the phone number' });
    expect(phoneLengthError('08012345678')).toBeNull();
  });
});
