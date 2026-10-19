import Link from 'next/link';
import { asRoute } from '@/lib/routes';

interface RepairsLabHeroActionSlotProps {
  className: string;
  href?: string;
  label: string;
}

export function RepairsLabHeroActionSlot({
  className,
  href,
  label,
}: RepairsLabHeroActionSlotProps) {
  return href ? (
    <Link href={asRoute(href)} className={className}>
      {label}
    </Link>
  ) : (
    <span aria-hidden="true" className={`${className} invisible`}>
      {label}
    </span>
  );
}
