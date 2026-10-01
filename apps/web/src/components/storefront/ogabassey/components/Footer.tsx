import type { MerchantData } from '@/hooks/merchant/types';
import { asRoute } from '@/lib/routes';
import { normalizeSocialUrl } from '@/lib/social';
import {
  buildMerchantTrustProfile,
  hasPublishableReturnsPolicy,
  hasPublishableShippingPolicy,
  hasPublishableWarrantyPolicy,
} from '@/lib/storefront-trust/build-merchant-trust-profile';
import {
  Facebook,
  Ghost,
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

import { FooterAppPayments } from './FooterAppPayments';
import { GadgetPattern } from './GadgetPattern';
import { Logo } from './Logo';

type SocialPlatform =
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | 'twitter'
  | 'youtube'
  | 'linkedin'
  | 'snapchat';

// Monochrome at rest (clean on the dark footer); the merchant accent appears
// on hover so the row stays theme-driven instead of hardcoding platform colors.
const SOCIAL_LINK_CLASS =
  'text-current/65 hover:text-store-primary transition-colors';

interface FooterProps {
  merchant?: MerchantData;
  storeSlug?: string;
}

type FooterLink = { label: string; href: ReturnType<typeof asRoute> };

function normalizeStoreSlug(storeSlug?: string): string {
  const normalized = storeSlug?.trim().replace(/^\/+|\/+$/g, '');
  return normalized ? `/${normalized}` : '';
}

function firstNonEmptyTrimmed(
  ...values: Array<string | null | undefined>
): string | undefined {
  return values
    .map((value) => value?.trim())
    .find((value): value is string => Boolean(value));
}

export const Footer: React.FC<FooterProps> = ({ merchant, storeSlug }) => {
  const basePath = normalizeStoreSlug(storeSlug);
  const businessName = merchant?.business_name || 'Ogabassey';
  const socialLinks = merchant?.social_media || {};
  // Prefer the public support email (what merchants edit in store settings) over the
  // private account email, so admin edits surface and the account email isn't exposed.
  const contactEmail =
    firstNonEmptyTrimmed(merchant?.support_email, merchant?.email) ??
    'support@ogabassey.com';
  const contactPhone = merchant?.phone || '+234 814 697 8921';
  const contactAddress =
    firstNonEmptyTrimmed(merchant?.business_address) ??
    '2 Olaide Tomori St, Ikeja, Lagos';
  // Open the storefront address in Google Maps. Derived from the address text
  // so it stays correct for any merchant using this template.
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    contactAddress
  )}`;
  const trustProfile = merchant
    ? buildMerchantTrustProfile(merchant, basePath || undefined)
    : null;
  const trustLinks: FooterLink[] = [
    trustProfile && hasPublishableReturnsPolicy(trustProfile)
      ? { label: 'Returns', href: asRoute(`${basePath}/returns`) }
      : null,
    trustProfile && hasPublishableShippingPolicy(trustProfile)
      ? { label: 'Shipping', href: asRoute(`${basePath}/shipping`) }
      : null,
    trustProfile && hasPublishableWarrantyPolicy(trustProfile)
      ? { label: 'Warranty', href: asRoute(`${basePath}/warranty`) }
      : null,
  ].filter((link): link is FooterLink => link !== null);

  // Helper to render social link if it exists
  const renderSocialLink = (
    input: string | undefined,
    label: string,
    platform: SocialPlatform,
    Icon: React.ElementType
  ) => {
    const url = normalizeSocialUrl(input, platform);
    if (!url) return null;
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={SOCIAL_LINK_CLASS}
        aria-label={label}
      >
        <Icon size={20} />
      </a>
    );
  };

  return (
    <footer className="ogabassey-footer border-t border-store-border/40 pt-10 pb-32 md:pb-10 relative overflow-hidden font-sans">
      <GadgetPattern className="ogabassey-footer__pattern" opacity={0.1} />

      <div className="max-w-[1400px] mx-auto px-6 lg:px-12 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-6">
          {/* Column 1: Brand Info (Compact) */}
          <div className="space-y-4">
            <Link
              href={asRoute(basePath || '/')}
              className="flex items-center cursor-pointer select-none"
            >
              <Logo className="h-8 w-auto" />
            </Link>
            <p className="text-current/65 text-xs leading-relaxed max-w-xs">
              Making Smartphones Accessible and Affordable
            </p>
            <div className="flex items-center gap-4 flex-wrap">
              {renderSocialLink(
                socialLinks.instagram,
                'Instagram',
                'instagram',
                Instagram
              )}
              {renderSocialLink(
                socialLinks.facebook,
                'Facebook',
                'facebook',
                Facebook
              )}
              {renderSocialLink(socialLinks.tiktok, 'TikTok', 'tiktok', Music)}
              {renderSocialLink(
                socialLinks.twitter,
                'X (Twitter)',
                'twitter',
                Twitter
              )}
              {renderSocialLink(
                socialLinks.youtube,
                'YouTube',
                'youtube',
                Youtube
              )}
              {renderSocialLink(
                socialLinks.linkedin,
                'LinkedIn',
                'linkedin',
                Linkedin
              )}
              {renderSocialLink(
                socialLinks.snapchat,
                'Snapchat',
                'snapchat',
                Ghost
              )}
            </div>
          </div>

          {/* Column 2: Quick Links (Merged) */}
          {/* Column 2: Quick Links (Unified) */}
          <nav className="flex justify-between md:justify-start gap-12" aria-label="Footer navigation">
            <div>
              <h3 className="text-sm font-bold mb-4 text-current uppercase tracking-wider">
                Menu
              </h3>
              <ul className="space-y-2 text-xs text-current/65">
                <li><Link href={asRoute(`${basePath}/about`)} className="hover:text-store-primary">About Us</Link></li>
                <li><Link href={asRoute(`${basePath}/blog`)} className="hover:text-store-primary">Blog</Link></li>
                <li><Link href={asRoute(`${basePath}/repairs`)} className="hover:text-store-primary">Repairs</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-bold mb-4 text-current uppercase tracking-wider">
                Support
              </h3>
              <ul className="space-y-2 text-xs text-current/65">
                <li><Link href={asRoute(`${basePath}/track-order`)} className="hover:text-store-primary">Track Order</Link></li>
                <li><Link href={asRoute(`${basePath}/faq`)} className="hover:text-store-primary">Help Center</Link></li>
                <li><Link href={asRoute(`${basePath}/contact`)} className="hover:text-store-primary">Contact Us</Link></li>
                <li><Link href={asRoute(`${basePath}/terms`)} className="hover:text-store-primary">Terms of Service</Link></li>
                <li><Link href={asRoute(`${basePath}/privacy`)} className="hover:text-store-primary">Privacy Policy</Link></li>
                {trustLinks.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className="hover:text-store-primary">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </nav>

          {/* Column 3: Contact (Compact) */}
          <address className="not-italic">
            <h3 className="text-sm font-bold mb-4 text-current uppercase tracking-wider">
              Contact
            </h3>
            <ul className="space-y-3 text-xs text-current/65">
              <li className="flex items-start gap-2">
                <MapPin className="shrink-0 text-store-primary" size={16} />
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${contactAddress} in Google Maps`}
                  className="hover:text-current transition-colors"
                >
                  {contactAddress}
                </a>
              </li>
              <li className="flex items-center gap-2">
                <Phone className="shrink-0 text-store-primary" size={16} />
                <a href={`tel:${contactPhone.replace(/\s/g, '')}`} className="hover:text-current transition-colors">
                  {contactPhone}
                </a>
              </li>
              <li className="flex items-center gap-2">
                <Mail className="shrink-0 text-store-primary" size={16} />
                <a
                  href={`mailto:${contactEmail}`}
                  className="hover:text-current transition-colors"
                >
                  {contactEmail}
                </a>
              </li>
            </ul>
          </address>

          {/* Column 4: App & Payment (Horizontal) */}
          <FooterAppPayments />
        </div>

        <div className="mt-8 pt-4 border-t border-store-border/40 text-center text-[10px] text-current/50">
          <span>&copy; {businessName}. All rights reserved.</span>
        </div>
      </div>
    </footer>
  );
};
