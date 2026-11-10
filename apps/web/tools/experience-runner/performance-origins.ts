import {
  productionDeliveryOrigins,
  productionOrigin,
} from '../../src/lib/experience/production-origins';
import { localPreviewHost } from './preview-origin';

export const HTTPS_PERFORMANCE_EXECUTION_ORIGIN =
  'https://artifacts.baci-cwv.invalid';
export function performanceOrigins(value: string) {
  if (new URL(value).protocol === 'https:') {
    const origin = productionOrigin(value);
    productionDeliveryOrigins({
      executionOrigin: HTTPS_PERFORMANCE_EXECUTION_ORIGIN,
      hostOrigins: [origin],
    });
    return {
      origin,
      hostPort: 4100,
      resourceOrigin: HTTPS_PERFORMANCE_EXECUTION_ORIGIN,
      frameOrigin: HTTPS_PERFORMANCE_EXECUTION_ORIGIN,
      transport: 'https-loopback-tls' as const,
    };
  }
  const origin = localPreviewHost(value);
  return {
    origin,
    hostPort: Number(new URL(origin).port),
    resourceOrigin: 'http://127.0.0.1:4101',
    frameOrigin: `http://${new URL(origin).hostname}:4101`,
    transport: 'http-loopback' as const,
  };
}
export { rewriteCssAssetUrls as performanceCss } from './rewrite-css-asset-urls';
