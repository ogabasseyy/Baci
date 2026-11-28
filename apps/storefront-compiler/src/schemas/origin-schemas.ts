import { z } from 'zod';

const IPV4_OR_IPV6_HOST = /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-fA-F:]+\])$/;

export const httpsOriginSchema = z
  .string()
  .min(8)
  .max(200)
  .refine((raw) => {
    if (raw.includes('*')) return false;
    try {
      const parsed = new URL(raw);
      return (
        parsed.protocol === 'https:' &&
        parsed.port === '' &&
        parsed.origin === raw &&
        parsed.username === '' &&
        parsed.password === '' &&
        parsed.pathname === '/' &&
        parsed.search === '' &&
        parsed.hash === '' &&
        parsed.hostname.includes('.') &&
        !IPV4_OR_IPV6_HOST.test(parsed.hostname)
      );
    } catch {
      return false;
    }
  }, 'CSP allowlist entry must be a bare HTTPS hostname origin without wildcards or raw IPs');

export const previewOriginSchema = z
  .string()
  .min(8)
  .max(200)
  .refine((raw) => {
    if (raw.includes('*')) return false;
    try {
      const parsed = new URL(raw);
      if (
        parsed.origin !== raw ||
        parsed.username !== '' ||
        parsed.password !== '' ||
        parsed.pathname !== '/' ||
        parsed.search !== '' ||
        parsed.hash !== ''
      ) {
        return false;
      }
      if (
        parsed.protocol === 'http:' &&
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
      ) {
        return true;
      }
      return (
        parsed.protocol === 'https:' &&
        (parsed.hostname === 'localhost' ||
          (parsed.hostname.includes('.') &&
            !IPV4_OR_IPV6_HOST.test(parsed.hostname)))
      );
    } catch {
      return false;
    }
  }, 'previewOrigin must be a valid HTTPS origin or localhost HTTP origin');

export const hostOriginSchema = z
  .string()
  .min(8)
  .max(200)
  .refine((raw) => {
    if (raw.includes('*')) return false;
    try {
      const parsed = new URL(raw);
      return (
        parsed.protocol === 'https:' &&
        parsed.port === '' &&
        parsed.origin === raw &&
        parsed.username === '' &&
        parsed.password === '' &&
        parsed.pathname === '/' &&
        parsed.search === '' &&
        parsed.hash === '' &&
        parsed.hostname.includes('.') &&
        parsed.hostname !== 'usebaci.com' &&
        parsed.hostname !== 'api.usebaci.com' &&
        parsed.hostname !== 'cdn.usebaci.com' &&
        !IPV4_OR_IPV6_HOST.test(parsed.hostname)
      );
    } catch {
      return false;
    }
  }, 'hostOrigin must be a bare HTTPS storefront origin without wildcards, ports, platform-reserved hosts, or raw IPs');
