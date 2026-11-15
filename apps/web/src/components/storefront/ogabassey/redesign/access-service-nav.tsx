import {
  ArrowLeftRight,
  Newspaper,
  ScanBarcode,
  Wallet,
  Wrench,
} from 'lucide-react';
import Link from 'next/link';
import { asRoute } from '@/lib/routes';
import { AccessSearchStyles } from './access-search-styles';

const services = [
  { label: 'IMEI Checker', path: '/imei-check', Icon: ScanBarcode },
  { label: 'Repairs', path: '/repairs', Icon: Wrench },
  { label: 'Swap / Trade-in', path: '/swap', Icon: ArrowLeftRight },
  { label: 'Wallet', path: '/wallet', Icon: Wallet },
  { label: 'Blog', path: '/blog', Icon: Newspaper },
];

export function AccessServiceNav({ basePath = '' }: { basePath?: string }) {
  return (
    <>
      <AccessSearchStyles />
      <nav className="oa-service-nav" aria-label="Device services and support">
        {services.map(({ label, path, Icon }) => (
          <Link
            key={path}
            href={asRoute(`${basePath}${path}`)}
            prefetch={false}
          >
            <Icon size={24} aria-hidden="true" />
            {label}
          </Link>
        ))}
      </nav>
    </>
  );
}
