import { expect, it } from 'vitest';
import { MAX_PUBLIC_OBSERVATION_REQUESTS } from '../../tools/experience-runner/public-observation-resource-limit';
import {
  publicCartHostResponse,
  publicCartWorkerFrame,
} from './experience-public-cart-channel';

it('shares request ID limits across both directions', () => {
  const id = MAX_PUBLIC_OBSERVATION_REQUESTS;
  const request = {
    type: 'request',
    id,
    request: { url: '/cart', method: 'GET' },
  };
  const response = { type: 'response', id, status: 200, body: '{}' };
  expect(publicCartWorkerFrame.parse(request)).toEqual(request);
  expect(publicCartHostResponse.parse(response)).toEqual(response);
  expect(
    publicCartWorkerFrame.safeParse({ ...request, id: id + 1 }).success
  ).toBe(false);
  expect(
    publicCartHostResponse.safeParse({ ...response, id: id + 1 }).success
  ).toBe(false);
  expect(
    publicCartHostResponse.safeParse({ ...response, status: 500 }).success
  ).toBe(false);
});
