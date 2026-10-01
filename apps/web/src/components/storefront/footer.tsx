'use client';

import {
  Facebook,
  Instagram,
  Linkedin,
  Mail,
  MapPin,
  Phone,
  Twitter,
  Youtube,
} from 'lucide-react';
import Link from 'next/link';
import { useMerchant } from '@/hooks/use-merchant-client';
import { asRoute } from '@/lib/routes';
import {
  buildMerchantTrustProfile,
  hasPublishableReturnsPolicy,
  hasPublishableShippingPolicy,
  hasPublishableWarrantyPolicy,
} from '@/lib/storefront-trust/build-merchant-trust-profile';

type FooterLink = { label: string; href: ReturnType<typeof asRoute> };

// TikTok and Pinterest don't have official lucide icons, so we create simple ones
const TikTokIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
  </svg>
);

const PinterestIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path d="M12 0a12 12 0 0 0-4.37 23.17c-.1-.94-.2-2.4.04-3.44l1.4-5.96s-.36-.72-.36-1.78c0-1.66.96-2.9 2.16-2.9 1.02 0 1.52.77 1.52 1.7 0 1.02-.66 2.56-1 3.98-.28 1.2.6 2.18 1.78 2.18 2.14 0 3.78-2.26 3.78-5.5 0-2.88-2.08-4.9-5.04-4.9-3.44 0-5.46 2.58-5.46 5.24 0 1.04.4 2.16.9 2.76.1.12.12.22.08.34l-.34 1.36c-.06.22-.18.26-.42.16-1.56-.72-2.54-3-2.54-4.84 0-3.94 2.86-7.56 8.26-7.56 4.34 0 7.7 3.08 7.7 7.2 0 4.3-2.72 7.78-6.5 7.78-1.26 0-2.46-.66-2.86-1.44l-.78 2.98c-.28 1.08-1.04 2.44-1.56 3.26A12 12 0 1 0 12 0z" />
  </svg>
);

/**
 * StorefrontFooter - Fully themeable via CSS variables
 *
 * Displays:
 * - Business name and copyright
 * - Quick links (based on merchant's configured pages)
 * - Social media links (from merchant.social_media)
 * - Contact info (email, phone, address)
 *
 * Theme variables:
 * - --theme-footer-bg: Background color
 * - --theme-footer-text: Text color
 * - --theme-footer-link: Link color
 * - --theme-footer-link-hover: Link hover color
 * - --theme-footer-py: Vertical padding
 * - --theme-footer-px: Horizontal padding
 */
export function StorefrontFooter() {
  const { merchant, basePath } = useMerchant();

  if (!merchant) return null;

  // Page links - only show relevant ones that merchant has set up
  const footerLinks = [
    { key: 'about', label: 'About Us' },
    { key: 'contact', label: 'Contact' },
    { key: 'faq', label: 'FAQs' },
    { key: 'privacy', label: 'Privacy Policy' },
    { key: 'terms', label: 'Terms' },
  ];

  const availableFooterLinks = footerLinks.filter(
    (link) => merchant.pages?.[link.key as keyof typeof merchant.pages]
  );
  const trustProfile = buildMerchantTrustProfile(merchant, basePath);
  const trustLinks: FooterLink[] = [
    hasPublishableReturnsPolicy(trustProfile)
      ? { label: 'Returns', href: asRoute(`${basePath || ''}/returns`) }
      : null,
    hasPublishableShippingPolicy(trustProfile)
      ? { label: 'Shipping', href: asRoute(`${basePath || ''}/shipping`) }
      : null,
    hasPublishableWarrantyPolicy(trustProfile)
      ? { label: 'Warranty', href: asRoute(`${basePath || ''}/warranty`) }
      : null,
  ].filter((link): link is FooterLink => link !== null);

  // Social media configuration
  const socialLinks = [
    {
      key: 'instagram',
      icon: Instagram,
      label: 'Instagram',
      urlPrefix: 'https://instagram.com/',
    },
    {
      key: 'twitter',
      icon: Twitter,
      label: 'Twitter',
      urlPrefix: 'https://twitter.com/',
    },
    {
      key: 'facebook',
      icon: Facebook,
      label: 'Facebook',
      urlPrefix: 'https://facebook.com/',
    },
    {
      key: 'tiktok',
      icon: TikTokIcon,
      label: 'TikTok',
      urlPrefix: 'https://www.tiktok.com/@',
    },
    {
      key: 'youtube',
      icon: Youtube,
      label: 'YouTube',
      urlPrefix: 'https://youtube.com/',
    },
    {
      key: 'linkedin',
      icon: Linkedin,
      label: 'LinkedIn',
      urlPrefix: 'https://linkedin.com/company/',
    },
    {
      key: 'pinterest',
      icon: PinterestIcon,
      label: 'Pinterest',
      urlPrefix: 'https://pinterest.com/',
    },
  ];

  const availableSocialLinks = socialLinks.filter(
    (link) =>
      merchant.social_media?.[link.key as keyof typeof merchant.social_media]
  );

  // Check if merchant has contact info
  const hasContactInfo =
    merchant.support_email ||
    merchant.support_phone ||
    merchant.business_address;

  return (
    <footer
      className="mt-auto"
      style={{
        backgroundColor: 'var(--theme-footer-bg, #1A202C)',
        color: 'var(--theme-footer-text, #FFFFFF)',
        paddingTop: 'var(--theme-footer-py, 3rem)',
        paddingBottom: 'var(--theme-footer-py, 3rem)',
      }}
    >
      <div
        className="container mx-auto"
        style={{
          paddingLeft: 'var(--theme-footer-px, 1rem)',
          paddingRight: 'var(--theme-footer-px, 1rem)',
        }}
      >
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand Section */}
          <div>
            <h3 className="text-lg font-semibold mb-4">
              {merchant.business_name}
            </h3>
            <p className="text-sm opacity-90">
              Your trusted destination for quality products and excellent
              service.
            </p>
          </div>

          {/* Quick Links */}
          {availableFooterLinks.length > 0 || trustLinks.length > 0 ? (
            <div>
              <h3 className="text-lg font-semibold mb-4">Quick Links</h3>
              <nav className="flex flex-col gap-2">
                {availableFooterLinks.map((link) => (
                  <Link
                    key={link.key}
                    href={asRoute(`${basePath || ''}/pages/${link.key}`)}
                    className="text-sm hover:underline underline-offset-4 opacity-90 hover:opacity-100 transition-opacity"
                    style={{
                      color: 'var(--theme-footer-link, currentColor)',
                    }}
                  >
                    {link.label}
                  </Link>
                ))}
                {trustLinks.map((link) => (
                  <Link
                    key={link.label}
                    href={link.href}
                    className="text-sm hover:underline underline-offset-4 opacity-90 hover:opacity-100 transition-opacity"
                    style={{
                      color: 'var(--theme-footer-link, currentColor)',
                    }}
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
            </div>
          ) : null}

          {/* Contact Info */}
          {hasContactInfo && (
            <div>
              <h3 className="text-lg font-semibold mb-4">Contact Us</h3>
              <div className="flex flex-col gap-3 text-sm opacity-90">
                {merchant.support_email && (
                  <a
                    href={`mailto:${merchant.support_email}`}
                    className="flex items-center gap-2 hover:opacity-100 transition-opacity"
                  >
                    <Mail className="size-4 shrink-0" />
                    <span>{merchant.support_email}</span>
                  </a>
                )}
                {merchant.support_phone && (
                  <a
                    href={`tel:${merchant.support_phone}`}
                    className="flex items-center gap-2 hover:opacity-100 transition-opacity"
                  >
                    <Phone className="size-4 shrink-0" />
                    <span>{merchant.support_phone}</span>
                  </a>
                )}
                {merchant.business_address && (
                  <div className="flex items-start gap-2">
                    <MapPin className="size-4 shrink-0 mt-0.5" />
                    <span>{merchant.business_address}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Social Media */}
          {availableSocialLinks.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-4">Follow Us</h3>
              <div className="flex flex-wrap gap-3">
                {availableSocialLinks.map((social) => {
                  const handle =
                    merchant.social_media?.[
                      social.key as keyof typeof merchant.social_media
                    ];
                  const url = handle?.startsWith('http')
                    ? handle
                    : `${social.urlPrefix}${handle?.replace('@', '')}`;
                  const Icon = social.icon;
                  return (
                    <a
                      key={social.key}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Follow us on ${social.label}`}
                      className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                      style={{
                        color: 'var(--theme-footer-link, currentColor)',
                      }}
                    >
                      <Icon className="size-5" />
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Copyright */}
        <div className="mt-8 pt-8 border-t border-white/10 text-center">
          <p className="text-sm opacity-80">
            <span suppressHydrationWarning>
              &copy; {merchant.business_name}. All
            </span>
            rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
