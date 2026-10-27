import { getOAuthQueryParams } from './oauth-query-params';

describe('OAuth callback parameters', () => {
  it('reads and decodes an authorization code from the query', () => {
    expect(getOAuthQueryParams('ogabassey://auth?code=a%2Bb')).toEqual({
      params: { code: 'a+b' },
      errorCode: null,
    });
  });
  it('merges fragment parameters over query parameters', () => {
    expect(
      getOAuthQueryParams('ogabassey://auth?code=old#code=new&state=ok')
    ).toEqual({
      params: { code: 'new', state: 'ok' },
      errorCode: null,
    });
  });
  it('keeps the query error separate from session parameters', () => {
    expect(
      getOAuthQueryParams('ogabassey://auth?errorCode=access_denied&state=ok')
    ).toEqual({
      params: { state: 'ok' },
      errorCode: 'access_denied',
    });
  });
  it('handles a fragment error before a stale query code', () => {
    expect(
      getOAuthQueryParams('ogabassey://auth?code=old#errorCode=access_denied')
    ).toEqual({ params: { code: 'old' }, errorCode: 'access_denied' });
  });
  it('lets fragment errors override query errors', () => {
    expect(
      getOAuthQueryParams('ogabassey://auth?errorCode=old#errorCode=new')
        .errorCode
    ).toBe('new');
  });
  it('preserves the last value when a query parameter repeats', () => {
    expect(
      getOAuthQueryParams('ogabassey://auth?code=old&code=new').params.code
    ).toBe('new');
  });
  it('preserves an empty code so the caller rejects the missing authorization code', () => {
    expect(getOAuthQueryParams('ogabassey://auth?code=')).toEqual({
      params: { code: '' },
      errorCode: null,
    });
  });
  it('rejects a malformed absolute callback URL', () => {
    expect(() => getOAuthQueryParams('https://[invalid')).toThrow();
  });
});
