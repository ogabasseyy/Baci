// Shared by Expo's Node config loader and the native runtime. No Node APIs.
const { sha256 } = require('@noble/hashes/sha2.js');
const { bytesToHex, utf8ToBytes } = require('@noble/hashes/utils.js');
const { validOxygenStagingPublicKey } = require('./oxygen-staging-public-key');
function readOxygenStagingProfile(input, development) {
  if (!development || !input || typeof input !== 'object')
    throw new Error('Oxygen staging requires an isolated development profile');
  const {
    apiOrigin,
    authOrigin,
    authBaseUrl = authOrigin,
    expectedAuthIssuer,
    publicKey,
    merchantId,
    merchantSlug,
  } = input;
  function origin(value, local) {
    const url = new URL(value);
    if (
      url.origin !== value ||
      url.username ||
      url.password ||
      !(
        url.protocol === 'https:' ||
        (local &&
          url.protocol === 'http:' &&
          ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
      )
    )
      throw new Error('Oxygen staging requires canonical pinned origins');
    return url;
  }
  const api = origin(apiOrigin, true);
  const auth = origin(authOrigin, true);
  const localGateway =
    auth.protocol === 'http:' && authBaseUrl === `${authOrigin}/qa-backend`;
  if (
    (auth.protocol === 'http:' && !localGateway) ||
    (!localGateway && authBaseUrl !== authOrigin)
  )
    throw new Error('Oxygen staging requires an exact pinned Auth base URL');
  let issuerAllowed = expectedAuthIssuer === `${authOrigin}/auth/v1`;
  if (localGateway) {
    issuerAllowed = expectedAuthIssuer === 'supabase';
    if (!issuerAllowed) {
      try {
        const issuer = new URL(expectedAuthIssuer);
        origin(issuer.origin, true);
        issuerAllowed = expectedAuthIssuer === `${issuer.origin}/auth/v1`;
      } catch {
        issuerAllowed = false;
      }
    }
  }
  if (
    (apiOrigin === authOrigin && !localGateway) ||
    ['usebaci.com', 'ogabassey.com', 'www.ogabassey.com'].includes(
      api.hostname
    ) ||
    !issuerAllowed ||
    !validOxygenStagingPublicKey(publicKey, expectedAuthIssuer, localGateway) ||
    typeof merchantId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      merchantId
    ) ||
    typeof merchantSlug !== 'string' ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(merchantSlug) ||
    merchantSlug.length > 100
  )
    throw new Error('Oxygen staging pins are invalid');
  const identity = bytesToHex(
    sha256(
      utf8ToBytes(
        JSON.stringify([
          apiOrigin,
          authOrigin,
          authBaseUrl,
          expectedAuthIssuer,
          merchantId,
          merchantSlug,
        ])
      )
    )
  );
  return Object.freeze({
    apiOrigin,
    authOrigin,
    authBaseUrl,
    expectedAuthIssuer,
    publicKey,
    merchantId,
    merchantSlug,
    environment: 'staging',
    appId: 'com.ogabassey.oxygenstaging',
    storagePrefix: `baci-oxygen-staging.v2.${identity}.`,
  });
}
module.exports = { readOxygenStagingProfile };
