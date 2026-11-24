import { productionOrigin } from '@/lib/experience/production-origins';
import { createPublicObservationExecutor } from '../experience-runner/public-observation-executor';
import {
  MAX_PUBLIC_OBSERVATION_BYTES,
  MAX_PUBLIC_OBSERVATION_RESOURCES,
  MAX_PUBLIC_RESOURCE_BYTES,
} from '../experience-runner/public-observation-resource-limit';
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
  routeCount: number;
  session: Args[4];
  signal?: AbortSignal;
}) => Promise<{ output: Record<string, unknown> }>;
const productionObserver = createPublicObservationExecutor();

/** Adapt checked resources to the fixed isolated job; does not install the job. */
export function createPublicObservationAdapter(
  productOrigin: string,
  run: Run = productionObserver
): Observe {
  const origin = productionOrigin(productOrigin);
  return async (
    binding,
    output,
    pages,
    expected,
    relay,
    framework,
    frames,
    signal
  ) => {
    signal?.throwIfAborted();
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
        url: item.requestUrl ?? item.canonical,
        mime: 'text/html',
        bytes: item.bytes,
        headers: item.securityHeaders,
      })),
      ...framework,
      ...frames,
    ];
    if (resources.length > MAX_PUBLIC_OBSERVATION_RESOURCES)
      throw Error('PUBLIC_OBSERVATION_INPUT_BUDGET');
    const urls = new Set<string>();
    let total = 0;
    for (const item of resources) {
      const url = new URL(item.url);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.hash ||
        url.href !== item.url ||
        urls.has(item.url) ||
        !Buffer.isBuffer(item.bytes) ||
        item.bytes.length > MAX_PUBLIC_RESOURCE_BYTES
      )
        throw Error('PUBLIC_OBSERVATION_INPUT_INVALID');
      urls.add(item.url);
      total += item.bytes.length;
      if (total > MAX_PUBLIC_OBSERVATION_BYTES)
        throw Error('PUBLIC_OBSERVATION_INPUT_BUDGET');
    }
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
      resources: resources.map((item) => ({
        url: item.url,
        mime: item.mime,
        bytes: item.bytes.toString('base64'),
        headers: item.headers,
      })),
    };
    return (
      await run({
        payload,
        routeCount: expected.routes.length,
        session: relay,
        signal,
      })
    ).output;
  };
}
