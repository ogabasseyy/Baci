import Link from 'next/link';
import { Logo } from '@/components/logo';
import { asRoute } from '@/lib/routes';
import { cn } from '@/lib/utils';

export function LabHeaderLogoFallback({
  getHref,
  layout,
  storeName,
}: {
  getHref: (path: string) => string;
  layout: 'logo-left-nav-center' | 'logo-left-nav-right' | 'logo-center';
  storeName: string;
}) {
  return (
    <Link
      href={asRoute(getHref('/'))}
      className={cn('flex items-center gap-2 group shrink-0', {
        'order-1': layout !== 'logo-center',
        'order-2 mx-auto': layout === 'logo-center',
      })}
    >
      <Logo className="transition-transform group-hover:scale-105" />
      <span
        className={cn('font-bold text-xl tracking-tight transition-colors')}
      >
        {storeName}
      </span>
    </Link>
  );
}
