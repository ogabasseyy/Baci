/** Synthetic local process fixture, never installed as a production worker. */

import { createPublicCartWorkerClient } from './public-cart-worker-client';
import { readPublicObservationStart } from './public-observation-start';

const start = await readPublicObservationStart(process.stdin);
if (
  !start ||
  typeof start !== 'object' ||
  !('synthetic' in start) ||
  start.synthetic !== true
)
  throw Error('INVALID_FIXTURE');
const client = createPublicCartWorkerClient({
  input: process.stdin,
  output: process.stdout,
});
const response = await client.request({
  url: 'https://shop.example/api/storefront/cart',
  method: 'GET',
});
await client.finish({ status: 'synthetic', cart: JSON.parse(response.body) });
