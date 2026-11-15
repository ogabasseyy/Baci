import type { AnchorHTMLAttributes } from 'react';

export default function HomeTestLink({ children, href, prefetch: _prefetch, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean }) {
  return <a href={href} {...props}>{children}</a>;
}
