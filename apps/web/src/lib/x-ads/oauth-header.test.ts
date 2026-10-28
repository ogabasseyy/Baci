import { expect, it } from 'vitest';
import { createXOAuthHeader } from './oauth-header';

it('matches the published OAuth 1.0 HMAC-SHA1 request vector', () => {
  const header = createXOAuthHeader(
    'http://photos.example.net/photos?file=vacation.jpg&size=original',
    'GET',
    {
      consumerKey: 'dpf43f3p2l4k3l03',
      consumerSecret: 'kd94hf93k423kf44',
      accessToken: 'nnch734d00sl2jdk',
      accessTokenSecret: 'pfkkdhi9sl3r4s00',
    },
    'kllo9940pd9333jh',
    '1191242096'
  );
  expect(header).toContain(
    'oauth_signature="tR3%2BTy81lMeYAr%2FFid0kMTYa%2FWM%3D"'
  );
});
it('creates distinct request signatures for different nonces', () => {
  const creds = {
    consumerKey: 'key',
    consumerSecret: 'secret',
    accessToken: 'token',
    accessTokenSecret: 'token-secret',
  };
  expect(
    createXOAuthHeader(
      'https://ads-api.x.com/12/measurement/conversions/abc',
      'POST',
      creds,
      'one',
      '1'
    )
  ).not.toEqual(
    createXOAuthHeader(
      'https://ads-api.x.com/12/measurement/conversions/abc',
      'POST',
      creds,
      'two',
      '1'
    )
  );
});
