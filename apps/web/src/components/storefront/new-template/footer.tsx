'use client';

import {
  Facebook,
  Instagram,
  Linkedin,
  Mail,
  MapPin,
  Music,
  Phone,
  Twitter,
  Youtube,
} from 'lucide-react';
import Link from 'next/link';
import type React from 'react';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { asRoute } from '@/lib/routes';
import { normalizeSocialUrl, type SocialPlatform } from '@/lib/social';
import { Logo } from './logo';

// Only routes that exist for every merchant storefront: this template is
// merchant-generic, so Ogabassey-gated routes (/repairs, /swap,
// /sustainability) must not appear here — they 404 on other stores.
const COMPANY_LINKS = [
  { label: 'About Us', path: '/about' },
  { label: 'Blog', path: '/blog' },
  { label: 'Privacy Policy', path: '/privacy' },
  { label: 'Terms & Conditions', path: '/terms' },
] as const;

const SERVICE_LINKS = [
  { label: 'Track Order', path: '/track-order' },
  { label: 'Shipping & Delivery', path: '/shipping' },
  { label: 'Returns', path: '/returns' },
  { label: 'Contact Support', path: '/contact' },
] as const;

const SOCIAL_LINKS: {
  key: SocialPlatform;
  label: string;
  Icon: React.ElementType;
}[] = [
  { key: 'instagram', label: 'Instagram', Icon: Instagram },
  { key: 'facebook', label: 'Facebook', Icon: Facebook },
  { key: 'tiktok', label: 'TikTok', Icon: Music },
  { key: 'twitter', label: 'Twitter', Icon: Twitter },
  { key: 'youtube', label: 'YouTube', Icon: Youtube },
  { key: 'linkedin', label: 'LinkedIn', Icon: Linkedin },
];

export const Footer: React.FC = () => {
  const merchantContext = useMerchantSafe();
  const merchant = merchantContext?.merchant;
  const basePath = merchantContext?.basePath || '';
  const getHref = (path: string) => asRoute(`${basePath}${path}`);
  const socialMedia = merchant?.social_media ?? {};
  // Merchants may save bare handles (e.g. `@techhub`) or full URLs; normalize
  // both into real profile URLs and drop anything that doesn't resolve, so we
  // never emit a handle as a relative storefront href.
  const socialLinks = SOCIAL_LINKS.map(({ key, label, Icon }) => ({
    key,
    label,
    Icon,
    url: normalizeSocialUrl(socialMedia[key], key),
  })).filter((link): link is typeof link & { url: string } =>
    Boolean(link.url)
  );
  const legalName = merchant?.legal_entity_name || merchant?.business_name;

  return (
    <footer className="bg-[#0a0a0a] text-white pt-20 pb-10 relative overflow-hidden">
      {/* Decorative Elements */}
      <div className="absolute top-0 left-0 w-full h-px bg-linear-to-r from-transparent via-gray-800 to-transparent" />
      <div className="absolute -top-40 -right-40 size-80 bg-red-600/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full h-[300px] bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.03] pointer-events-none" />

      {/* Pattern Overlay */}
      <div
        className="absolute inset-0 opacity-[0.02] pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(#ffffff 1px, transparent 1px)`,
          backgroundSize: '140px 140px',
        }}
      />

      <div className="max-w-[1400px] mx-auto px-6 lg:px-12 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 lg:gap-6">
          {/* Column 1: Brand Info */}
          <div className="space-y-4">
            <Link
              href={getHref('/')}
              className="flex items-center cursor-pointer select-none"
            >
              <Logo className="h-8 w-auto" />
            </Link>
            {socialLinks.length > 0 && (
              <div className="flex items-center gap-4 flex-wrap">
                {socialLinks.map(({ key, label, Icon, url }) => (
                  <a
                    key={key}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-400 hover:text-white transition-colors"
                    aria-label={label}
                  >
                    <Icon size={20} />
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Column 2: Quick Links */}
          <div className="flex justify-between md:justify-start gap-12">
            <div>
              <h3 className="text-sm font-bold mb-4 text-white uppercase tracking-wider">
                Company
              </h3>
              <ul className="space-y-2 text-xs text-gray-400">
                {COMPANY_LINKS.map(({ label, path }) => (
                  <li key={path}>
                    <Link href={getHref(path)} className="hover:text-red-500">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-bold mb-4 text-white uppercase tracking-wider">
                Services
              </h3>
              <ul className="space-y-2 text-xs text-gray-400">
                {SERVICE_LINKS.map(({ label, path }) => (
                  <li key={path}>
                    <Link href={getHref(path)} className="hover:text-red-500">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Column 3: Contact */}
          {(merchant?.business_address ||
            merchant?.support_phone ||
            merchant?.support_email) && (
            <div>
              <h3 className="text-sm font-bold mb-4 text-white uppercase tracking-wider">
                Contact
              </h3>
              <ul className="space-y-3 text-xs text-gray-400">
                {merchant?.business_address && (
                  <li className="flex items-start gap-2">
                    <MapPin className="shrink-0 text-red-600" size={16} />
                    <span>{merchant.business_address}</span>
                  </li>
                )}
                {merchant?.support_phone && (
                  <li className="flex items-center gap-2">
                    <Phone className="shrink-0 text-red-600" size={16} />
                    <a
                      href={`tel:${merchant.support_phone}`}
                      className="hover:text-white transition-colors"
                    >
                      {merchant.support_phone}
                    </a>
                  </li>
                )}
                {merchant?.support_email && (
                  <li className="flex items-center gap-2">
                    <Mail className="shrink-0 text-red-600" size={16} />
                    <a
                      href={`mailto:${merchant.support_email}`}
                      className="hover:text-white transition-colors"
                    >
                      {merchant.support_email}
                    </a>
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>

        <div className="mt-8 pt-4 border-t border-gray-800 text-center text-[10px] text-gray-500">
          <span suppressHydrationWarning>
            &copy;
            {legalName ? ` ${legalName}.` : ''} All rights reserved.
          </span>
        </div>
      </div>
    </footer>
  );
};
