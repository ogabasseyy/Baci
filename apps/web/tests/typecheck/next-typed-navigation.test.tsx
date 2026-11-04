// Compile-time regression coverage, checked by the normal web tsc gate.
// These functions are never called or imported by application runtime code.
import type { Route } from 'next';
import Link from 'next/link';
import { permanentRedirect, redirect, useRouter } from 'next/navigation';
import { expect, it } from 'vitest';
import { HoverPrefetchLink } from '@/components/ui/hover-prefetch-link';
import { asRoute } from '@/lib/routes';

function CheckedLinks({ path, slug }: { path: string; slug: string }) {
  const route: Route = asRoute(path);
  return (
    <>
      <HoverPrefetchLink href={route}>Checked hover URL</HoverPrefetchLink>
      {/* @ts-expect-error The hover wrapper must also reject unchecked URLs. */}
      <HoverPrefetchLink href={path}>Unchecked hover URL</HoverPrefetchLink>
      <Link href={route}>Checked URL</Link>
      <Link href={asRoute(path)}>Checked dynamic URL</Link>
      <Link href={`/qa1/products/${slug}`}>Inferred dynamic URL</Link>
      <Link href={{ pathname: '/qa1', query: { q: 'synthetic' } }}>
        URL object
      </Link>
      <Link href="/pricing" prefetch={false}>
        Static route
      </Link>
      {/* @ts-expect-error Unchecked arbitrary strings must still be rejected. */}
      <Link href={path}>Invalid unchecked URL</Link>
      {/* @ts-expect-error Invalid literals must still be rejected. */}
      <Link href="not-a-valid-route">Invalid literal</Link>
    </>
  );
}

function useCheckedRouter(path: string, slug: string) {
  const router = useRouter();
  const route: Route = asRoute(path);
  router.push(route, { scroll: false });
  router.replace(route, { scroll: true });
  router.prefetch(route);
  router.push(`/qa1/products/${slug}`);
  // @ts-expect-error Arbitrary strings must still be checked at the call site.
  router.push(path);
  // @ts-expect-error Invalid literals must remain rejected by replace.
  router.replace('not-a-valid-route');
  // @ts-expect-error Invalid literals must remain rejected by prefetch.
  router.prefetch('not-a-valid-route');
}

function checkedRedirect(path: Route) {
  return redirect(path);
}
function checkedPermanentRedirect(path: Route) {
  return permanentRedirect(path);
}
function invalidRedirect(path: string) {
  // @ts-expect-error Redirects must not gain a broad unchecked string overload.
  return redirect(path);
}
function invalidPermanentRedirect(path: string) {
  // @ts-expect-error Permanent redirects must retain their typed-route boundary.
  return permanentRedirect(path);
}

it('preserves the runtime string identity assumed by the checked-route compiler contract', () => {
  void [
    CheckedLinks,
    useCheckedRouter,
    checkedRedirect,
    checkedPermanentRedirect,
    invalidRedirect,
    invalidPermanentRedirect,
  ];
  const path = '/qa1/products/synthetic-device';
  expect(asRoute(path)).toBe(path);
  expect(asRoute('https://synthetic.example/qa1')).toBe(
    'https://synthetic.example/qa1'
  );
});
