export function checkoutHref(basePath: string | undefined, path: string): string {
  return path.startsWith('http') ? path : `${basePath || ''}${path === '/' ? '' : path}`;
}
