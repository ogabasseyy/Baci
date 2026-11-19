import { describe, expect, it } from 'vitest';
import { getAddressAutocompleteKvCredentialIssue } from './address-autocomplete-kv-credentials';

describe('getAddressAutocompleteKvCredentialIssue', () => {
  it('accepts a complete credential pair', () => {
    expect(
      getAddressAutocompleteKvCredentialIssue({
        ADDRESS_AUTOCOMPLETE_KV_REST_API_TOKEN: 'test-token',
        ADDRESS_AUTOCOMPLETE_KV_REST_API_URL: 'https://kv.example.test',
      })
    ).toBeNull();
  });

  it('accepts an absent credential pair', () => {
    expect(getAddressAutocompleteKvCredentialIssue({})).toBeNull();
  });

  it('requires a token when only the endpoint is configured', () => {
    expect(
      getAddressAutocompleteKvCredentialIssue({
        ADDRESS_AUTOCOMPLETE_KV_REST_API_URL: 'https://kv.example.test',
      })
    ).toEqual({
      field: 'ADDRESS_AUTOCOMPLETE_KV_REST_API_TOKEN',
      message:
        'ADDRESS_AUTOCOMPLETE_KV_REST_API_TOKEN is required when ADDRESS_AUTOCOMPLETE_KV_REST_API_URL is set',
    });
  });

  it('requires an endpoint when only the token is configured', () => {
    expect(
      getAddressAutocompleteKvCredentialIssue({
        ADDRESS_AUTOCOMPLETE_KV_REST_API_TOKEN: 'test-token',
      })
    ).toEqual({
      field: 'ADDRESS_AUTOCOMPLETE_KV_REST_API_URL',
      message:
        'ADDRESS_AUTOCOMPLETE_KV_REST_API_URL is required when ADDRESS_AUTOCOMPLETE_KV_REST_API_TOKEN is set',
    });
  });
});
