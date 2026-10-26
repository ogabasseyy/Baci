import { Facebook, Instagram, Linkedin, Twitter, Youtube } from 'lucide-react';
import Link from 'next/link';
import type { ComponentType } from 'react';
import { FooterPresentation } from '@/components/storefront/portable/footer-presentation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { asRoute } from '@/lib/routes';
import { getStorefrontScopedHref } from './storefront-scoping';

type SocialLinks = {
  facebook?: string;
  instagram?: string;
  twitter?: string;
  linkedin?: string;
  youtube?: string;
};

export type CuratedFooterProps = {
  brandName?: string;
  copyrightText?: string;
  quickLinksLabel?: string;
  socialLinksLabel?: string;
  showQuickLinks: boolean;
  quickLinks: { label: string; url: string }[];
  socialLinks: SocialLinks;
  showNewsletter?: boolean;
  backgroundColor?: string;
  textColor?: string;
};

const socialIcons: Record<string, ComponentType<{ className?: string }>> = {
  facebook: Facebook,
  instagram: Instagram,
  twitter: Twitter,
  linkedin: Linkedin,
  youtube: Youtube,
};

export function CuratedFooter({
  brandName = 'Store',
  copyrightText = '© Store. All rights reserved.',
  quickLinksLabel = 'Quick Links',
  socialLinksLabel = 'Follow Us',
  showQuickLinks,
  quickLinks,
  socialLinks,
  showNewsletter,
  backgroundColor,
  textColor,
}: CuratedFooterProps) {
  const merchantContext = useMerchantSafe();
  const basePath = merchantContext?.basePath;
  const visibleSocialLinks = Object.entries(socialLinks).filter(
    ([platform, url]) => Boolean(url) && Boolean(socialIcons[platform])
  );

  return (
    <FooterPresentation
      brandName={brandName}
      copyrightText={copyrightText}
      backgroundColor={backgroundColor}
      textColor={textColor}
    >
      {showQuickLinks && quickLinks.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-4">{quickLinksLabel}</h3>
          <nav aria-label="Footer Navigation">
            <ul className="flex flex-col gap-2 list-none p-0 m-0">
              {quickLinks.map((link) => (
                <li key={link.url}>
                  <Link
                    href={asRoute(getStorefrontScopedHref(link.url, basePath))}
                    className="text-sm hover:underline underline-offset-4"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      )}

      {visibleSocialLinks.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-4">{socialLinksLabel}</h3>
          <div className="flex gap-4">
            {visibleSocialLinks.map(([platform, url]) => {
              const Icon = socialIcons[platform];
              return (
                <Link
                  key={platform}
                  href={asRoute(url)}
                  className="transition-opacity hover:opacity-100"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Follow us on ${platform}`}
                >
                  <Icon className="size-5" />
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {showNewsletter && (
        <div>
          <h3 className="text-lg font-semibold mb-4">Newsletter</h3>
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="Your email"
              className="flex-1"
              aria-label="Email address for newsletter"
            />
            <Button size="sm">Subscribe</Button>
          </div>
        </div>
      )}
    </FooterPresentation>
  );
}
