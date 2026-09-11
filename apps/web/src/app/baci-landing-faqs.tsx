import Link from 'next/link';
import { FAQItem } from '@/components/landing/faq-item';
import { JsonLd } from '@/components/seo/json-ld';
import { Button } from '@/components/ui/button';

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
          {[
            {
              question: 'Do I need coding skills to use Baci?',
              answer:
                'Not at all! Baci is designed for everyone. Our AI handles all the technical work—you just answer a few questions about your business, and we create your entire store automatically.',
            },
            {
              question: 'How long does it take to launch my store?',
              answer:
                'Most merchants go live in under 10 minutes. The AI generates your store in seconds, and you can customize and launch immediately. No waiting for developers or designers.',
            },
            {
              question: 'Can I use my own domain name?',
              answer:
                'Yes! You can connect your custom domain or use a free Baci subdomain. We provide step-by-step instructions to connect your domain from providers like GoDaddy, Namecheap, or Google Domains.',
            },
            {
              question: 'What payment methods can I accept?',
              answer:
                'Baci integrates with major payment processors including Stripe, PayPal, and local payment methods. Accept credit cards, debit cards, digital wallets, and more—all with secure, PCI-compliant checkout.',
            },
            {
              question: 'Is there a free trial?',
              answer:
                "Yes! Start with our 14-day free trial. No credit card required. Test all features, build your store, and only pay when you're ready to go live.",
            },
            {
              question: 'Can I migrate from another platform?',
              answer:
                'Absolutely. We offer free migration assistance for stores moving from Shopify, WooCommerce, or other platforms. Our team will help you import your products, customers, and orders seamlessly.',
            },
            {
              question: 'Do you offer customer support?',
              answer:
                'Yes! We provide 24/7 email support for all plans, plus live chat and priority support for premium customers. Our comprehensive knowledge base and video tutorials are also available anytime.',
            },
            {
              question: 'Can I sell physical and digital products?',
              answer:
                'Yes! Baci supports both physical products (with inventory tracking and shipping) and digital products (instant delivery via secure download links). You can sell both types in the same store.',
            },
          ].map((faq) => (
            <FAQItem
              key={faq.question}
              question={faq.question}
              answer={faq.answer}
            />
          ))}
        </dl>

        <div className="mt-12 text-center animate-fade-in">
          <p className="text-muted-foreground mb-4">
            Still have questions? We're here to help.
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
            mainEntity: [
              {
                '@type': 'Question',
                name: 'Do I need coding skills to use Baci?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: 'Not at all! Baci is designed for everyone. Our AI handles all the technical work—you just answer a few questions about your business, and we create your entire store automatically.',
                },
              },
              {
                '@type': 'Question',
                name: 'How long does it take to launch my store?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: 'Most merchants go live in under 10 minutes. The AI generates your store in seconds, and you can customize and launch immediately. No waiting for developers or designers.',
                },
              },
              {
                '@type': 'Question',
                name: 'Can I use my own domain name?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: 'Yes! You can connect your custom domain or use a free Baci subdomain. We provide step-by-step instructions to connect your domain from providers like GoDaddy, Namecheap, or Google Domains.',
                },
              },
              {
                '@type': 'Question',
                name: 'What payment methods can I accept?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: 'Baci integrates with major payment processors including Stripe, PayPal, and local payment methods. Accept credit cards, debit cards, digital wallets, and more—all with secure, PCI-compliant checkout.',
                },
              },
              {
                '@type': 'Question',
                name: 'Is there a free trial?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: "Yes! Start with our 14-day free trial. No credit card required. Test all features, build your store, and only pay when you're ready to go live.",
                },
              },
              {
                '@type': 'Question',
                name: 'Can I migrate from another platform?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: 'Absolutely. We offer free migration assistance for stores moving from Shopify, WooCommerce, or other platforms. Our team will help you import your products, customers, and orders seamlessly.',
                },
              },
              {
                '@type': 'Question',
                name: 'Do you offer customer support?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: 'Yes! We provide 24/7 email support for all plans, plus live chat and priority support for premium customers. Our comprehensive knowledge base and video tutorials are also available anytime.',
                },
              },
              {
                '@type': 'Question',
                name: 'Can I sell physical and digital products?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: 'Yes! Baci supports both physical products (with inventory tracking and shipping) and digital products (instant delivery via secure download links). You can sell both types in the same store.',
                },
              },
            ],
          }}
        />
      </div>
    </section>
  );
}
