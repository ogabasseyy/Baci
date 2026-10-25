'use client';

import { AlertCircle, CheckCircle, Scale, ScrollText } from 'lucide-react';
import { StorefrontFooter } from '@/components/storefront/footer';
import { StorefrontHeader } from '@/components/storefront/header';
import { SafeHtml } from '@/components/ui/safe-html';

import { ContentPageProviders } from '../content-page-providers';

interface TermsPageClientProps {
  merchant: {
    id: string;
    slug: string;
    business_name: string;
    logo_url?: string;
    email?: string;
    brand_colors?: {
      primary?: string;
      secondary?: string;
      accent?: string;
      background?: string;
    };
    pages?: {
      terms?: string;
    };
  };
  content?: string;
}

export function TermsPageClient({ merchant, content }: TermsPageClientProps) {
  return (
    <ContentPageProviders merchant={merchant}>
      <div className="flex flex-col min-h-screen">
        <StorefrontHeader />

        <main className="flex-1">
          {/* Hero Section */}
          <section className="relative py-16 md:py-20 bg-linear-to-b from-muted/50 to-background">
            <div className="container px-4 md:px-6 text-center">
              <div className="flex justify-center mb-6">
                <div className="p-4 bg-primary/10 rounded-full">
                  <ScrollText className="size-10 text-primary" />
                </div>
              </div>
              <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
                Terms of Service
              </h1>
              <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
                Please read these terms carefully before using our services.
              </p>
            </div>
          </section>

          {/* Key Points */}
          <section className="border-b">
            <div className="container px-4 md:px-6 py-8">
              <div className="grid sm:grid-cols-3 gap-6 max-w-4xl mx-auto">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-100 dark:bg-green-900/20 rounded-lg">
                    <CheckCircle className="size-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="font-medium">Agreement</p>
                    <p className="text-sm text-muted-foreground">
                      \ Using our site means you agree
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-amber-100 dark:bg-amber-900/20 rounded-lg">
                    <AlertCircle className="size-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className="font-medium">Responsibilities</p>
                    <p className="text-sm text-muted-foreground">
                      \ Know your obligations
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 dark:bg-blue-900/20 rounded-lg">
                    <Scale className="size-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="font-medium">Fair Use</p>
                    <p className="text-sm text-muted-foreground">
                      \ Balanced rights & limits
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
                  <p>Terms of service content is being prepared.</p>
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
                  If you have any questions about these Terms of Service, please
                  contact us.
                </p>
              </div>
            </div>
          </div>
        </main>

        <StorefrontFooter />
      </div>
    </ContentPageProviders>
  );
}
