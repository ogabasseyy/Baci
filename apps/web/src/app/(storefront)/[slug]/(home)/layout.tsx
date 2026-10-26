import type { ReactNode } from 'react';

export default function StorefrontFullCssLayout({
  children,
}: {
  children: ReactNode;
  params?: Promise<{ slug: string }>;
}) {
  return children;
}
