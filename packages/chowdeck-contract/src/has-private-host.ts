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
        const firstHextet = Number.parseInt(hostname.split(':')[0] || '0', 16);
        return (
          hostname === '::' ||
          hostname === '::1' ||
          (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) ||
          (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) ||
          hostname.startsWith('::ffff:') ||
          hostname.startsWith('64:ff9b:') ||
          /^::[0-9a-f]{1,4}:[0-9a-f]{1,4}$/i.test(hostname)
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
        (first === 192 && second === 168) ||
        (first === 192 && second === 0 && octets[2] === 0) ||
        (first === 198 && (second === 18 || second === 19)) ||
        (first !== undefined && first >= 224)
      );
    } catch {
      return true;
    }
  });
}
