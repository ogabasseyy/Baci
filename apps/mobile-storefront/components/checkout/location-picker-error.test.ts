import { getLocationPickerError } from './location-picker-error';

describe('getLocationPickerError', () => {
  it('returns nothing when the field has no error', () => {
    expect(getLocationPickerError('city', '', undefined)).toBeUndefined();
    expect(getLocationPickerError('state', 'Lagos', undefined)).toBeUndefined();
  });

  it('asks the shopper to choose when the picker is empty', () => {
    expect(getLocationPickerError('city', undefined, 'Too short')).toBe(
      'Choose a city'
    );
    expect(getLocationPickerError('state', '', 'Required')).toBe(
      'Choose a state'
    );
  });

  it('treats a whitespace-only value as empty', () => {
    expect(getLocationPickerError('city', '   ', 'Too short')).toBe(
      'Choose a city'
    );
  });

  it('keeps the schema message once a value is chosen', () => {
    expect(getLocationPickerError('city', 'Ikeja', 'Too short')).toBe(
      'Too short'
    );
  });
});
