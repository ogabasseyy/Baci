import { resolveGoogleCitySuggestionAction } from './checkout-shipping.helpers';

interface ApplyCheckoutGoogleCitySuggestionParams {
  cities: string[];
  onClearSuggestion: () => void;
  onOpenPicker: () => void;
  onSearchCity: (city: string) => void;
  onSelectCity: (city: string) => void;
  suggestedCity: string | null;
}

export function applyCheckoutGoogleCitySuggestion({
  cities,
  onClearSuggestion,
  onOpenPicker,
  onSearchCity,
  onSelectCity,
  suggestedCity,
}: ApplyCheckoutGoogleCitySuggestionParams): void {
  if (cities.length === 0 && suggestedCity !== null) {
    onClearSuggestion();
    if (suggestedCity) onSelectCity(suggestedCity);
    else onOpenPicker();
    return;
  }
  const action = resolveGoogleCitySuggestionAction(cities, suggestedCity);
  if (action.type === 'none') return;

  onClearSuggestion();
  if (action.type === 'openPicker') {
    onOpenPicker();
    return;
  }
  if (action.type === 'selectCity') {
    onSelectCity(action.city);
    return;
  }
  onSearchCity(action.city);
  onOpenPicker();
}
