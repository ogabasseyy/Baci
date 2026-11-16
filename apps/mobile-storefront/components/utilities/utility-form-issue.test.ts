import { getAirtimeFormIssue, getDataFormIssue } from './utility-form-issue';

describe('getAirtimeFormIssue', () => {
  const valid = {
    numericAmount: 100,
    phoneNumber: '08031234567',
    selectedProvider: 'mtn',
  };

  it('is null for a complete form', () => {
    expect(getAirtimeFormIssue(valid)).toBeNull();
  });

  // The walk found an iOS "Missing Information" alert for an empty phone.
  it('asks for the phone number above Pay when it is empty', () => {
    expect(getAirtimeFormIssue({ ...valid, phoneNumber: '' })).toEqual({
      field: 'phone',
      inline: false,
      message: 'Enter the phone number to top up.',
    });
  });

  it('only hints while a number is still being typed', () => {
    expect(
      getAirtimeFormIssue({ ...valid, phoneNumber: '0803' })
    ).toMatchObject({ field: 'phone', inline: false });
  });

  it('flags a full-length number that is not a local number at the field', () => {
    expect(
      getAirtimeFormIssue({ ...valid, phoneNumber: '12345678901' })
    ).toEqual({
      field: 'phone',
      inline: true,
      message: 'Enter an 11-digit phone number, like 08012345678.',
    });
  });

  it('asks for the network when none is chosen', () => {
    expect(
      getAirtimeFormIssue({ ...valid, selectedProvider: null })
    ).toMatchObject({ field: 'network', inline: false });
  });

  it('asks for an amount when none is chosen', () => {
    expect(getAirtimeFormIssue({ ...valid, numericAmount: 0 })).toMatchObject({
      field: 'amount',
      inline: false,
      message: 'Choose or enter an amount.',
    });
  });

  it.each([
    49, 50_001,
  ])('flags an out-of-range amount (%p) at the field', (numericAmount) => {
    expect(getAirtimeFormIssue({ ...valid, numericAmount })).toEqual({
      field: 'amount',
      inline: true,
      message: 'Amount must be between ₦50 and ₦50,000.',
    });
  });

  it.each([50, 50_000])('accepts the boundary amount %p', (numericAmount) => {
    expect(getAirtimeFormIssue({ ...valid, numericAmount })).toBeNull();
  });
});

describe('getDataFormIssue', () => {
  const valid = {
    phoneNumber: '08031234567',
    planAmount: 500,
    selectedPlan: 'MTN-1GB',
    selectedProvider: 'mtn',
  };

  it('is null for a complete form', () => {
    expect(getDataFormIssue(valid)).toBeNull();
  });

  it('asks for the phone number first', () => {
    expect(getDataFormIssue({ ...valid, phoneNumber: '' })).toMatchObject({
      message: 'Enter the phone number to send data to.',
    });
  });

  it('asks for a bundle when none is chosen', () => {
    expect(getDataFormIssue({ ...valid, selectedPlan: null })).toMatchObject({
      field: 'bundle',
      message: 'Choose a data bundle.',
    });
  });

  it('asks for an amount when the bundle has none', () => {
    expect(getDataFormIssue({ ...valid, planAmount: 0 })).toMatchObject({
      field: 'amount',
      message: 'Enter an amount for this bundle.',
    });
  });
});
