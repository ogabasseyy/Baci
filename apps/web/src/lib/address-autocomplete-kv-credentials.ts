interface AddressAutocompleteKvCredentials {
  ADDRESS_AUTOCOMPLETE_KV_REST_API_TOKEN?: string;
  ADDRESS_AUTOCOMPLETE_KV_REST_API_URL?: string;
}

type AddressAutocompleteKvCredentialField =
  | 'ADDRESS_AUTOCOMPLETE_KV_REST_API_TOKEN'
  | 'ADDRESS_AUTOCOMPLETE_KV_REST_API_URL';

export function getAddressAutocompleteKvCredentialIssue(
  value: AddressAutocompleteKvCredentials
): { field: AddressAutocompleteKvCredentialField; message: string } | null {
  if (
    value.ADDRESS_AUTOCOMPLETE_KV_REST_API_URL &&
    !value.ADDRESS_AUTOCOMPLETE_KV_REST_API_TOKEN
  ) {
    return {
      field: 'ADDRESS_AUTOCOMPLETE_KV_REST_API_TOKEN',
      message:
        'ADDRESS_AUTOCOMPLETE_KV_REST_API_TOKEN is required when ADDRESS_AUTOCOMPLETE_KV_REST_API_URL is set',
    };
  }

  if (
    value.ADDRESS_AUTOCOMPLETE_KV_REST_API_TOKEN &&
    !value.ADDRESS_AUTOCOMPLETE_KV_REST_API_URL
  ) {
    return {
      field: 'ADDRESS_AUTOCOMPLETE_KV_REST_API_URL',
      message:
        'ADDRESS_AUTOCOMPLETE_KV_REST_API_URL is required when ADDRESS_AUTOCOMPLETE_KV_REST_API_TOKEN is set',
    };
  }

  return null;
}
