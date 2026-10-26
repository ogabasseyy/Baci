/** Strict public-only egress even in tests/development. Resolved addresses are pinned to TLS. */
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { Agent, fetch } from 'undici';
import { isBuilderPreviewAsset } from '../../src/schemas/builder-preview-assets';
import { isBoundPublicHomeRpc } from './publication-public-rpc';

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(net, prefix, 'ipv4');
blocked.addSubnet('2002::', 16, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');
blocked.addSubnet('2001::', 32, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
export function isPublicPublicationAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family === 6)
    return globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
  return false;
}
export interface PublicationFetchOptions {
  resolve?: (
    hostname: string
  ) => Promise<{ address: string; family: number }[]>;
  signal?: AbortSignal;
  publicDatabase?: {
    origin: string;
    publishableKey: string;
    merchantId: string;
  };
}
export function createSafePublicationFetcher(
  options: PublicationFetchOptions = {}
) {
  let total = 0;
  let requests = 0;
  return async (value: string) => {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    )
      throw Error('Unsafe publication URL');
    const canonical =
      url.hostname === 'usebaci.com' ||
      /^(?:[a-z0-9]|[a-z0-9][a-z0-9-]{0,61}[a-z0-9])\.usebaci\.com$/.test(
        url.hostname
      );
    const db = options.publicDatabase;
    const publicRpc = isBoundPublicHomeRpc(value, db);
    if (!canonical && !isBuilderPreviewAsset(url.href) && !publicRpc)
      throw Error('Unsafe publication resource');
    if (++requests > 60) throw Error('Publication request bound exceeded');
    let dnsTimer: ReturnType<typeof setTimeout> | undefined;
    const addresses = await Promise.race([
      (options.resolve ?? ((host) => lookup(host, { all: true })))(
        url.hostname
      ),
      new Promise<never>((_resolve, reject) => {
        dnsTimer = setTimeout(
          () => reject(Error('Publication DNS timeout')),
          5000
        );
      }),
    ]).finally(() => clearTimeout(dnsTimer));
    if (
      !addresses.length ||
      addresses.some((a) => !isPublicPublicationAddress(a.address))
    )
      throw Error('Unsafe publication DNS address');
    const address = addresses.find((a) => a.family === 4) ?? addresses[0];
    const dispatcher = new Agent({
      connect: {
        autoSelectFamily: false,
        lookup: (_host, _opts, callback) =>
          callback(null, address.address, address.family),
      },
    });
    try {
      const headers: Record<string, string> = {
        accept: '*/*',
        'user-agent': 'Baci-Publication-Verification/1.0',
      };
      if (publicRpc && db) headers.apikey = db.publishableKey;
      const response = await fetch(url, {
        method: 'GET',
        headers,
        redirect: 'manual',
        dispatcher,
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(10000)])
          : AbortSignal.timeout(10000),
      });
      if (response.status < 200 || response.status >= 300)
        throw Error('Publication redirect or resource failure');
      const length = Number(response.headers.get('content-length') ?? 0);
      if (length > 2 * 1024 * 1024)
        throw Error('Publication resource too large');
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader)
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            total += part.value.byteLength;
            if (size > 2 * 1024 * 1024 || total > 10 * 1024 * 1024)
              throw Error('Publication resource bound exceeded');
            chunks.push(part.value);
          }
        } finally {
          await reader.cancel().catch(() => {
            /* Stream may already be closed. */
          });
        }
      const body = Buffer.concat(chunks);
      const safeHeaders: Record<string, string> = {
        'cache-control': 'no-store',
      };
      for (const key of [
        'content-type',
        'content-security-policy',
        'cross-origin-resource-policy',
        'cross-origin-opener-policy',
      ]) {
        const header = response.headers.get(key);
        if (header) safeHeaders[key] = header;
      }
      return { status: response.status, headers: safeHeaders, body };
    } finally {
      await dispatcher.close();
    }
  };
}
