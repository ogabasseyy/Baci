import { AddressAutocompleteAttribution } from './address-autocomplete-attribution';

export function AddressAutocompleteFeedback({
  provider,
  suggestionsFailed,
}: {
  provider?: 'google' | 'geoapify';
  suggestionsFailed: boolean;
}) {
  return (
    <>
      {provider === 'geoapify' && (
        <div className="mt-2">
          <AddressAutocompleteAttribution provider="geoapify" />
        </div>
      )}
      {suggestionsFailed && (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          Address suggestions are unavailable. You can enter your full address,
          including city and state, manually.
        </p>
      )}
    </>
  );
}
