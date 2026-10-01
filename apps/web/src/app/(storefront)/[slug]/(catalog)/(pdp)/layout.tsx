import '@/app/(storefront)/storefront-core.css';
import type { ReactNode } from 'react';

// The prior `await connection()` here forced the whole PDP route group
// request-bound to dodge a Next 16 PPR resume/metadata-boundary collision.
// That upstream bug (vercel/next.js#94630) is now fixed via
// patches/next@16.2.9.patch (PR #2436), so this guard is no longer needed and
// removing it lets prerendered PDPs ship the hero in the static shell.
export default function StorefrontPdpLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}
