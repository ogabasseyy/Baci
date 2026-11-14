import { productionOrigin } from '@/lib/experience/production-origins';
import { runPublicObservationJob } from '../experience-runner/public-observation-executor';
import type { createPublicVerificationCoordinator } from './public-verification-coordinator';

type Observe = Parameters<
  typeof createPublicVerificationCoordinator
>[0]['observe'];
type Args = Parameters<Observe>;
type EncodedResource = {
  url: string;
  mime: string;
  bytes: string;
  headers: Record<string, string>;
};
type Payload = {
  version: 1;
  origin: string;
  product: {
    origin: string;
    merchantId: string;
    productId: string;
    variantId?: string;
  };
  expected: Args[3];
  resources: EncodedResource[];
};
type Run = (input: {
  payload: Payload;
  session: Args[4];
}) => Promise<{ output: Record<string, unknown> }>;

/** Adapt checked resources to the fixed isolated job; does not install the job. */
export function createPublicObservationAdapter(
  productOrigin: string,
  run: Run = runPublicObservationJob
): Observe {
  const origin = productionOrigin(productOrigin);
  return async (binding, output, pages, expected, relay, framework, frames) => {
    if (
      binding.buildDigest !== expected.buildDigest ||
      !pages.length ||
      !frames.length ||
      !output.length
    )
      throw Error('PUBLIC_OBSERVATION_INPUT_INVALID');
    const resources = [
      ...output.map((item) => ({
        url: item.url,
        mime: item.mime,
        bytes: item.bytes,
        headers: item.securityHeaders,
      })),
      ...pages.map((item) => ({
        url: item.canonical,
        mime: 'text/html',
        bytes: item.bytes,
        headers: item.securityHeaders,
      })),
      ...framework,
      ...frames,
    ];
    if (resources.length > 256) throw Error('PUBLIC_OBSERVATION_INPUT_BUDGET');
    const urls = new Set<string>();
    let total = 0;
    const encoded = resources.map((item) => {
      const url = new URL(item.url);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.hash ||
        url.href !== item.url ||
        urls.has(item.url) ||
        !Buffer.isBuffer(item.bytes) ||
        item.bytes.length > 2097152
      )
        throw Error('PUBLIC_OBSERVATION_INPUT_INVALID');
      urls.add(item.url);
      total += item.bytes.length;
      if (total > 5500000) throw Error('PUBLIC_OBSERVATION_INPUT_BUDGET');
      return {
        url: item.url,
        mime: item.mime,
        bytes: item.bytes.toString('base64'),
        headers: item.headers,
      };
    });
    const payload: Payload = {
      version: 1,
      origin: binding.canonicalBase,
      product: {
        origin,
        merchantId: binding.merchantId,
        productId: expected.product.id,
        ...(expected.product.variantId
          ? { variantId: expected.product.variantId }
          : {}),
      },
      expected,
      resources: encoded,
    };
    if (Buffer.byteLength(JSON.stringify({ type: 'start', payload })) > 8388608)
      throw Error('PUBLIC_OBSERVATION_INPUT_BUDGET');
    return (await run({ payload, session: relay })).output;
  };
}
