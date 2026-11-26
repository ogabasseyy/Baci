import Link from 'next/link';
import { FAQItem } from '@/components/landing/faq-item';
import { JsonLd } from '@/components/seo/json-ld';
import { Button } from '@/components/ui/button';

const LANDING_FAQS = [
  {
    question: 'Do I need coding skills to use Baci?',
    answer:
      'Not at all! Baci is designed for everyone. Our AI handles store setup, branding, and copy—you just answer a few questions about your business, then customize visually with 29+ drag-and-drop blocks.',
  },
  {
    question: 'How long does it take to launch my store?',
    answer:
      'Most merchants go live in under 10 minutes. AI generates your store, logo, and brand colors in seconds, and you can connect payments and publish immediately.',
  },
  {
    question: 'Can customers negotiate prices or use discount codes?',
    answer:
      'Yes! Baci has built-in price negotiations (single-item and whole-cart offers with margin-protected counter-offers and real-time mobile approvals), plus percentage or fixed-amount discount codes, promo vouchers, and tiered loyalty rewards.',
  },
  {
    question: 'What payment methods can I accept?',
    answer:
      'Baci supports Paystack, Korapay, Dedicated Virtual Bank Accounts (DVA), Pay on Delivery, Pay-for-Me links, USDT/USDC crypto via Juicyway, and Buy Now Pay Later through CredPal, Credit Direct, and Klump—plus Ship on Credit and branch Virtual Terminals.',
  },
  {
    question: 'Can I buy or connect my own domain name and email?',
    answer:
      'Yes! You can search and buy a custom domain right inside Baci with automatic SSL and DNS management, connect an existing domain, or start with a free subdomain. You can also verify a custom sender email domain (like noreply@yourstore.com).',
  },
  {
    question: 'Can I migrate my existing products and orders?',
    answer:
      'Yes. You can import historical orders and catalogs from Bumpa CSV exports (with automated customer receipt-claim campaigns), sync a live Google Sheet, upload CSVs, or paste raw WhatsApp price lists for AI parsing.',
  },
  {
    question: 'Can I manage my store from my phone?',
    answer:
      'Yes! The Baci Mobile Admin app lets you approve price negotiations, follow up on abandoned checkouts via WhatsApp, scan barcodes, track serialized units, log expenses, view true profit, and export PDF invoices and tax ledgers.',
  },
  {
    question: 'Is there a free plan or trial?',
    answer:
      'Yes! Start free with no credit card required. Build your store, test your checkout, and upgrade whenever your business is ready to unlock unlimited products, custom domains, and pro analytics.',
  },
] as const;

export function BaciLandingFaqs() {
  return (
    <section
      id="faqs"
      className="py-24 bg-slate-50 dark:bg-slate-900/50 content-auto contain-intrinsic-size-[1px_1000px]"
    >
      <div
        className="container"
        style={{
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl mb-4 text-primary dark:text-white">
            Frequently Asked Questions
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Everything you need to know about building your store with Baci.
          </p>
        </div>

        <dl className="max-w-4xl mx-auto space-y-6">
          {LANDING_FAQS.map((faq) => (
            <FAQItem
              key={faq.question}
              question={faq.question}
              answer={faq.answer}
            />
          ))}
        </dl>

        <div className="mt-12 text-center animate-fade-in">
          <p className="text-muted-foreground mb-4">
            Still have questions? We&apos;re here to help.
          </p>
          <Button
            asChild
            variant="outline"
            className="rounded-full border-2 hover:bg-accent/5 hover:text-accent hover:border-accent/50 transition-all"
          >
            <Link href="/contact">Contact Support</Link>
          </Button>
        </div>

        {/* FAQ Schema */}
        <JsonLd
          data={{
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: LANDING_FAQS.map((faq) => ({
              '@type': 'Question',
              name: faq.question,
              acceptedAnswer: {
                '@type': 'Answer',
                text: faq.answer,
              },
            })),
          }}
        />
      </div>
    </section>
  );
}
