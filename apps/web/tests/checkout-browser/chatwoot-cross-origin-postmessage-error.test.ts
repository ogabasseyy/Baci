import { expect, it } from 'vitest';
import { isChatwootCrossOriginPostMessageError } from './chatwoot-cross-origin-postmessage-error';

it('matches only the fixture’s blocked target-origin diagnostics', () => {
  expect(
    isChatwootCrossOriginPostMessageError(
      "Failed to execute 'postMessage': target https://support.example.test does not match https://untrusted.example.test"
    )
  ).toBe(true);
  expect(
    isChatwootCrossOriginPostMessageError(
      'Unable to post message to https://support.example.test. Recipient has origin https://untrusted.example.test.'
    )
  ).toBe(true);
  expect(
    isChatwootCrossOriginPostMessageError(
      'Unrelated postMessage issue for https://support.example.test and https://untrusted.example.test'
    )
  ).toBe(false);
});
