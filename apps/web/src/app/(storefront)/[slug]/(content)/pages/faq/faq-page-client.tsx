'use client';

import { HelpCircle, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import AppBody from '@/components/app-body';
import { StorefrontFooter } from '@/components/storefront/footer';
import { StorefrontHeader } from '@/components/storefront/header';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SafeHtml } from '@/components/ui/safe-html';
import { StorefrontProvider } from '@/contexts/storefront-context';
import { MerchantProvider } from '@/hooks/merchant/merchant-provider';
import { type FAQItem, groupFAQsByCategory } from '@/types/faq';
import { ContactCTA } from './contact-cta';

interface FAQPageClientProps {
  merchant: {
    id: string;
    slug: string;
    business_name: string;
    logo_url?: string;
    brand_colors?: {
      primary?: string;
      secondary?: string;
      accent?: string;
      background?: string;
    };
    pages?: {
      faq?: string;
    };
  };
  faqItems: FAQItem[];
  legacyContent?: string;
  children?: ReactNode;
}

export function FAQPageClient({
  merchant,
  faqItems,
  legacyContent,
  children,
}: FAQPageClientProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const hasStructuredFAQs = faqItems.length > 0;

  // Filter FAQs based on search
  const filteredFAQs = searchQuery
    ? faqItems.filter(
        (faq) =>
          faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
          faq.answer.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : faqItems;

  // Group FAQs by category
  const groupedFAQs = groupFAQsByCategory(filteredFAQs);
  const categories = Object.keys(groupedFAQs);

  /*
     JSON-LD is handled server-side in page.tsx using generateFAQSchema.
     Client-side injection is removed to prevent duplication and SEO confusion.
  */

  return (
    <MerchantProvider slug={merchant.slug}>
      <StorefrontProvider>
        <AppBody
          merchant={merchant as Parameters<typeof AppBody>[0]['merchant']}
        >
          <div className="flex flex-col min-h-screen">
            <StorefrontHeader />

            <main className="flex-1">
              {/* Hero Section */}
              <section className="relative py-16 md:py-20 bg-linear-to-b from-muted/50 to-background">
                <div className="container px-4 md:px-6 text-center">
                  <div className="flex justify-center mb-6">
                    <div className="p-4 bg-primary/10 rounded-full">
                      <HelpCircle className="size-10 text-primary" />
                    </div>
                  </div>
                  <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
                    Frequently Asked Questions
                  </h1>
                  <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
                    Find answers to common questions about{' '}
                    {merchant.business_name}
                  </p>

                  {/* Search */}
                  {hasStructuredFAQs && (
                    <search className="max-w-md mx-auto relative">
                      <Search
                        className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <Input
                        type="search"
                        placeholder="Search questions..."
                        className="pl-10 h-12 text-lg"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        aria-label="Search frequently asked questions"
                      />
                    </search>
                  )}
                </div>
              </section>

              {/* FAQ Content */}
              <div className="container px-4 md:px-6 py-12 md:py-16">
                {hasStructuredFAQs ? (
                  <div className="max-w-3xl mx-auto">
                    {filteredFAQs.length === 0 ? (
                      <div className="text-center py-12">
                        <p className="text-muted-foreground">
                          No questions found matching "{searchQuery}"
                        </p>
                      </div>
                    ) : categories.length === 1 &&
                      categories[0] === 'General' ? (
                      /* Single category - no tabs */
                      <Accordion
                        type="single"
                        collapsible
                        className="space-y-4"
                      >
                        {filteredFAQs.map((faq, index) => (
                          <AccordionItem
                            key={faq.id || `faq-${index}`}
                            value={`faq-${index}`}
                            className="border rounded-lg px-6"
                          >
                            <AccordionTrigger className="text-left font-medium hover:no-underline py-4">
                              {faq.question}
                            </AccordionTrigger>
                            <AccordionContent className="text-muted-foreground pb-4">
                              <SafeHtml
                                html={faq.answer}
                                className="prose prose-sm dark:prose-invert max-w-none"
                              />
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    ) : (
                      /* Multiple categories */
                      <div className="space-y-10">
                        {categories.map((category) => (
                          <section
                            key={category}
                            aria-labelledby={`category-${category}`}
                          >
                            <div className="flex items-center gap-3 mb-4">
                              <h2
                                id={`category-${category}`}
                                className="text-2xl font-bold"
                              >
                                {category}
                              </h2>
                              <Badge variant="secondary">
                                {groupedFAQs[category].length}
                              </Badge>
                            </div>
                            <Accordion
                              type="single"
                              collapsible
                              className="space-y-3"
                            >
                              {groupedFAQs[category].map((faq, index) => (
                                <AccordionItem
                                  key={faq.id || `${category}-${index}`}
                                  value={`${category}-${index}`}
                                  className="border rounded-lg px-6"
                                >
                                  <AccordionTrigger className="text-left font-medium hover:no-underline py-4">
                                    {faq.question}
                                  </AccordionTrigger>
                                  <AccordionContent className="text-muted-foreground pb-4">
                                    <SafeHtml
                                      html={faq.answer}
                                      className="prose prose-sm dark:prose-invert max-w-none"
                                    />
                                  </AccordionContent>
                                </AccordionItem>
                              ))}
                            </Accordion>
                          </section>
                        ))}
                      </div>
                    )}
                  </div>
                ) : legacyContent ? (
                  /* Legacy content fallback */
                  <div className="max-w-3xl mx-auto">
                    <SafeHtml
                      html={legacyContent}
                      className="prose prose-lg dark:prose-invert max-w-none"
                    />
                  </div>
                ) : null}

                {/* Still have questions? */}
                <div className="max-w-3xl mx-auto mt-16 text-center p-8 bg-muted/30 rounded-2xl">
                  <h2 className="text-2xl font-bold mb-3">
                    Still have questions?
                  </h2>
                  <p className="text-muted-foreground mb-4">
                    Can't find what you're looking for? We're here to help.
                  </p>
                  <ContactCTA />
                </div>
              </div>
              {children}
            </main>

            <StorefrontFooter />
          </div>
        </AppBody>
      </StorefrontProvider>
    </MerchantProvider>
  );
}
