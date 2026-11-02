const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}
