import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { asRoute } from '@/lib/routes';

export function OrderSuccessNavigationLink({
  href,
  primary,
  children,
}: {
  href: string;
  primary: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={asRoute(href)}
      className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-6 py-4 font-bold transition-colors ${
        primary
          ? 'bg-store-primary text-store-primary-text hover:bg-store-primary/90'
          : 'border border-gray-200 bg-white text-gray-900 hover:bg-gray-50'
      }`}
    >
      {children}
      <ArrowRight size={18} />
    </Link>
  );
}
