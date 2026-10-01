'use client';

import { Facebook, Instagram, Linkedin, Twitter, Youtube } from 'lucide-react';
import Link from 'next/link';
import { useStorefrontScopedRoute } from '@/components/builder/use-storefront-scoped-route';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { asRoute } from '@/lib/routes';

export interface FooterProps {
  businessName?: string;
  copyrightText?: string;
  showQuickLinks?: boolean;
  quickLinks?: { label: string; url: string }[];
  socialLinks?: {
    facebook?: string;
    instagram?: string;
    twitter?: string;
    linkedin?: string;
    youtube?: string;
  };
  showNewsletter?: boolean;
  backgroundColor?: string;
  textColor?: string;
}

export function Footer({
  businessName = 'Store',
  copyrightText,
  showQuickLinks = true,
  quickLinks = [],
  socialLinks = {},
  showNewsletter = true,
  backgroundColor,
  textColor,
}: FooterProps) {
  const toStorefrontRoute = useStorefrontScopedRoute();
  const socialIcons: Record<
    string,
    React.ComponentType<{ className?: string }>
  > = {
    facebook: Facebook,
    instagram: Instagram,
    twitter: Twitter,
    linkedin: Linkedin,
    youtube: Youtube,
  };

  return (
    <footer
      className="pt-16 pb-8"
      style={{
        backgroundColor: backgroundColor || '#171717', // neutral-900
        color: textColor || '#FFFFFF',
      }}
    >
      <div className="container mx-auto px-4 md:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
          {/* Brand Section */}
          <div className="col-span-1 md:col-span-1">
            <h3 className="text-2xl font-bold mb-6">{businessName}</h3>
            <p className="text-neutral-400 text-sm leading-relaxed">
              Premium quality products curated with care. We believe in style,
              sustainability, and customer satisfaction.
            </p>
          </div>

          {/* Quick Links */}
          {showQuickLinks && (
            <div>
              <h4 className="font-semibold mb-6 text-lg">Shop</h4>
              <ul className="space-y-3 text-neutral-400 text-sm">
                <li>
                  <Link
                    href="#products"
                    className="hover:text-white transition-colors"
                  >
                    All Products
                  </Link>
                </li>
                {quickLinks.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={toStorefrontRoute(link.url)}
                      className="hover:text-white transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Support Links (Static for now, could be dynamic) */}
          <div>
            <h4 className="font-semibold mb-6 text-lg">Support</h4>
            <ul className="space-y-3 text-neutral-400 text-sm">
              <li>
                <Link href="#" className="hover:text-white transition-colors">
                  FAQ
                </Link>
              </li>
              <li>
                <Link href="#" className="hover:text-white transition-colors">
                  Shipping & Returns
                </Link>
              </li>
              <li>
                <Link href="#" className="hover:text-white transition-colors">
                  Contact Us
                </Link>
              </li>
            </ul>
          </div>

          {/* Social & Newsletter */}
          <div>
            <h4 className="font-semibold mb-6 text-lg">Stay Connected</h4>
            <div className="flex gap-4 mb-6">
              {Object.entries(socialLinks).map(([platform, url]) => {
                if (!url) return null;
                const Icon = socialIcons[platform];
                return (
                  <Link
                    key={platform}
                    href={asRoute(url)}
                    className="size-10 bg-white/10 rounded-full flex items-center justify-center hover:bg-white hover:text-black transition-all"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Icon className="size-5" />
                  </Link>
                );
              })}
            </div>

            {showNewsletter && (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-neutral-400 mb-2">
                  Subscribe to our newsletter
                </p>
                <div className="flex gap-2">
                  <Input
                    placeholder="Email address"
                    className="bg-white/10 border-white/10 text-white placeholder:text-neutral-500 focus-visible:ring-white/20"
                  />
                  <Button variant="secondary">Join</Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-neutral-500 text-sm">
            {copyrightText || `© ${businessName}. Powered by Baci.`}
          </p>
          <div className="flex gap-6 text-sm text-neutral-500">
            <Link href="#" className="hover:text-white transition-colors">
              Privacy Policy
            </Link>
            <Link href="#" className="hover:text-white transition-colors">
              Terms of Service
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
