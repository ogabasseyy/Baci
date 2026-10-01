import Image from 'next/image';
import Link from 'next/link';
import { Logo } from '@/components/logo';
import { asRoute } from '@/lib/routes';
import { cn } from '@/lib/utils';

/**
 * Storefront header brand lockup (extracted from Header): linked logo mark
 * plus store name. Rendered markup is unchanged.
 */
export function HeaderLogo({
  getHref,
  layout,
  logoUrl,
  storeName,
}: {
  getHref: (path: string) => string;
  layout: 'logo-left-nav-center' | 'logo-left-nav-right' | 'logo-center';
  logoUrl: string | undefined;
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
      {logoUrl ? (
        <Image
          src={logoUrl}
          alt={storeName}
          width={40}
          height={40}
          className="rounded-full object-cover ring-2 ring-white/50 shadow-sm transition-transform group-hover:scale-105"
        />
      ) : (
        <Logo className="transition-transform group-hover:scale-105" />
      )}
      <span
        className={cn('font-bold text-xl tracking-tight transition-colors')}
      >
        {storeName}
      </span>
    </Link>
  );
}
