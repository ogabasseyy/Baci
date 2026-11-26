// Apply only to HTML documents so direct navigation has the same opaque
// origin as the authored iframe. Static resources retain their own policy.
export const deliveryDocumentSandbox = 'sandbox allow-scripts';

export function publishedDeliveryPolicy(hostOrigin: string) {
  return `default-src 'none';script-src 'self';style-src 'self' 'unsafe-inline';img-src 'self';font-src 'self';connect-src 'none';worker-src 'none';form-action 'none';base-uri 'none';frame-ancestors ${hostOrigin}`;
}
