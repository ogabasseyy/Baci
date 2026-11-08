'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { asRoute } from '@/lib/routes';
import { cn } from '@/lib/utils';

export interface OgabasseyNavProps {
  links: {
    label: string;
    url: string;
  }[];
  activeColor?: string;
}

export function OgabasseyNav({
  links = [
    { label: 'Home', url: '/' },
    { label: 'Smart phones', url: '/category/smart-phones' },
    { label: 'Laptops', url: '/category/laptops' },
    { label: 'Accessories', url: '/category/accessories' },
    { label: 'Gaming', url: '/category/gaming' },
    { label: 'About Us', url: '/about' },
    { label: 'Pay In Installments', url: '/pages/installments' },
    { label: 'Sell or Swap Device', url: '/swap' },
  ],
  activeColor = '#D62027', // Ogabassey Red
}: OgabasseyNavProps) {
  const pathname = usePathname();
  const [activeNav, setActiveNav] = useState('');
  const merchantContext = useMerchantSafe();
  const basePath = merchantContext?.basePath;

  return (
    <div className="w-full border-b border-gray-100 bg-white sticky top-16 z-40 shadow-sm hidden md:block">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-12">
          <nav className="flex-1 overflow-x-auto hide-scrollbar">
            <ul className="flex items-center gap-6 whitespace-nowrap">
              {links.map((link) => {
                const isActive =
                  pathname === link.url || activeNav === link.label;

                const href = link.url.startsWith('http')
                  ? link.url
                  : `${basePath || ''}${link.url === '/' ? '' : link.url}`;

                return (
                  <li key={link.label}>
                    <Link
                      href={asRoute(href)}
                      onClick={() => setActiveNav(link.label)}
                      className={cn(
                        'text-sm font-medium transition-colors hover:text-primary relative py-3 block',
                        isActive
                          ? 'text-primary font-semibold'
                          : 'text-gray-600'
                      )}
                      style={{ color: isActive ? activeColor : undefined }}
                    >
                      {link.label}
                      {isActive && (
                        <span
                          className="absolute bottom-0 left-0 w-full h-0.5 bg-primary"
                          style={{ backgroundColor: activeColor }}
                        />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="flex items-center text-gray-400 pl-4 border-l border-gray-100 ml-4">
            <ChevronRight className="size-5" />
          </div>
        </div>
      </div>
    </div>
  );
}
