import { isIP } from 'node:net';

export function hasPrivateHost(value: string): boolean {
  const urls = value.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
  return urls.some((candidate) => {
    try {
      const hostname = new URL(candidate).hostname
        .toLowerCase()
        .replace(/^\[|\]$/g, '')
        .replace(/\.$/, '');
      if (isIP(hostname) === 6) {
        return (
          hostname === '::' ||
          hostname === '::1' ||
          /^(?:fc|fd|fe[89ab])/i.test(hostname) ||
          hostname.startsWith('::ffff:')
        );
      }
      if (
        hostname === 'localhost' ||
        hostname.endsWith('.localhost') ||
        hostname.endsWith('.local')
      ) {
        return true;
      }
      const octets = hostname.split('.').map(Number);
      if (octets.length !== 4 || octets.some(Number.isNaN)) return false;
      const [first, second] = octets;
      return (
        first === 0 ||
        first === 10 ||
        first === 127 ||
        (first === 100 &&
          second !== undefined &&
          second >= 64 &&
          second <= 127) ||
        (first === 169 && second === 254) ||
        (first === 172 &&
          second !== undefined &&
          second >= 16 &&
          second <= 31) ||
        (first === 192 && second === 168)
      );
    } catch {
      return true;
    }
  });
}
