import { describe, expect, it, jest } from '@jest/globals';
import { applyCheckoutGoogleCitySuggestion } from './apply-checkout-google-city-suggestion';

function createCallbacks() {
  return {
    onClearSuggestion: jest.fn(),
    onOpenPicker: jest.fn(),
    onSearchCity: jest.fn(),
    onSelectCity: jest.fn(),
  };
}

describe('applyCheckoutGoogleCitySuggestion', () => {
  it('selects a canonical carrier city when the Google city matches', () => {
    const callbacks = createCallbacks();

    applyCheckoutGoogleCitySuggestion({
      cities: ['Ikeja', 'Lagos'],
      suggestedCity: 'Ikeja',
      ...callbacks,
    });

    expect(callbacks.onClearSuggestion).toHaveBeenCalledTimes(1);
    expect(callbacks.onSelectCity).toHaveBeenCalledWith('Ikeja');
    expect(callbacks.onOpenPicker).not.toHaveBeenCalled();
  });

  it('opens the picker when Google did not return a city', () => {
    const callbacks = createCallbacks();

    applyCheckoutGoogleCitySuggestion({
      cities: ['Ikeja', 'Lagos'],
      suggestedCity: '',
      ...callbacks,
    });

    expect(callbacks.onClearSuggestion).toHaveBeenCalledTimes(1);
    expect(callbacks.onOpenPicker).toHaveBeenCalledTimes(1);
    expect(callbacks.onSelectCity).not.toHaveBeenCalled();
  });

  it('uses the Google city when carrier city validation is unavailable', () => {
    const callbacks = createCallbacks();

    applyCheckoutGoogleCitySuggestion({
      cities: [],
      suggestedCity: 'Lagos',
      ...callbacks,
    });

    expect(callbacks.onClearSuggestion).toHaveBeenCalledTimes(1);
    expect(callbacks.onSelectCity).toHaveBeenCalledWith('Lagos');
    expect(callbacks.onOpenPicker).not.toHaveBeenCalled();
  });
});
