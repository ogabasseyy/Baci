'use client';

import { Eye, FileText, Lock, Shield } from 'lucide-react';
import AppBody from '@/components/app-body';
import { StorefrontFooter } from '@/components/storefront/footer';
import { StorefrontHeader } from '@/components/storefront/header';
import { SafeHtml } from '@/components/ui/safe-html';
import { StorefrontProvider } from '@/contexts/storefront-context';
import { MerchantProvider } from '@/hooks/merchant/merchant-provider';
import type { CachedMerchant } from '@/lib/cached-data';
import { toTemplateMerchantData } from '@/lib/merchant-template-data';

interface PrivacyPageClientProps {
  merchant: CachedMerchant;
  content?: string;
}

export function PrivacyPageClient({
  merchant,
  content,
}: PrivacyPageClientProps) {
  return (
    <MerchantProvider slug={merchant.slug}>
      <StorefrontProvider>
        <AppBody merchant={toTemplateMerchantData(merchant)}>
          <div className="flex flex-col min-h-screen">
            <StorefrontHeader />

            <main className="flex-1">
              {/* Hero Section */}
              <section className="relative py-16 md:py-20 bg-linear-to-b from-muted/50 to-background">
                <div className="container px-4 md:px-6 text-center">
                  <div className="flex justify-center mb-6">
                    <div className="p-4 bg-primary/10 rounded-full">
                      <Shield className="size-10 text-primary" />
                    </div>
                  </div>
                  <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
                    Privacy Policy
                  </h1>
                  <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
                    Your privacy is important to us. Learn how we protect your
                    information.
                  </p>
                </div>
              </section>

              {/* Privacy Highlights */}
              <section className="border-b">
                <div className="container px-4 md:px-6 py-8">
                  <div className="grid sm:grid-cols-3 gap-6 max-w-4xl mx-auto">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-green-100 dark:bg-green-900/20 rounded-lg">
                        <Lock className="size-5 text-green-600 dark:text-green-400" />
                      </div>
                      <div>
                        <p className="font-medium">Secure Data</p>
                        <p className="text-sm text-muted-foreground">
                          Your data is encrypted
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-100 dark:bg-blue-900/20 rounded-lg">
                        <Eye className="size-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <p className="font-medium">Transparency</p>
                        <p className="text-sm text-muted-foreground">
                          Clear about what we collect
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-purple-100 dark:bg-purple-900/20 rounded-lg">
                        <FileText className="size-5 text-purple-600 dark:text-purple-400" />
                      </div>
                      <div>
                        <p className="font-medium">Your Rights</p>
                        <p className="text-sm text-muted-foreground">
                          Control your information
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* Content */}
              <div className="container px-4 md:px-6 py-12 md:py-16">
                <div className="max-w-3xl mx-auto">
                  {content ? (
                    <SafeHtml
                      html={content}
                      className="prose prose-lg dark:prose-invert max-w-none
                        prose-headings:font-bold prose-headings:tracking-tight
                        prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-4
                        prose-h3:text-xl prose-h3:mt-6 prose-h3:mb-3
                        prose-p:text-muted-foreground prose-p:leading-relaxed
                        prose-li:text-muted-foreground
                        prose-a:text-primary prose-a:no-underline prose-a:hover:underline"
                    />
                  ) : (
                    <div className="text-center text-muted-foreground py-12">
                      <p>Privacy policy content is being prepared.</p>
                      <p className="mt-2">
                        For questions, contact us at{' '}
                        {merchant.email ? (
                          <a
                            href={`mailto:${merchant.email}`}
                            className="text-primary hover:underline"
                          >
                            {merchant.email}
                          </a>
                        ) : (
                          'our support team'
                        )}
                        .
                      </p>
                    </div>
                  )}

                  {/* Last Updated */}
                  <div className="mt-12 pt-8 border-t">
                    <p className="text-sm text-muted-foreground text-center">
                      If you have any questions about this Privacy Policy,
                      please contact us.
                    </p>
                  </div>
                </div>
              </div>
            </main>

            <StorefrontFooter />
          </div>
        </AppBody>
      </StorefrontProvider>
    </MerchantProvider>
  );
}
