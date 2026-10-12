import type { LucideIcon } from 'lucide-react';
import {
  BarChart,
  CreditCard,
  FileText,
  Globe,
  MessageCircle,
  Palette,
  ShoppingBag,
  Smartphone,
  Truck,
  Users,
  Zap,
} from 'lucide-react';
import type { Metadata } from 'next';
import AppBody from '@/components/app-body';
import { PlatformFooter } from '@/components/platform/footer';
import { PlatformHeader } from '@/components/platform/header';

export const metadata: Metadata = {
  title: 'Features - Baci',
  description:
    'Explore Baci merchant workflows: AI-assisted stores, payments, inventory, shipping, domains, Jumia, team access and mobile business management.',
};

type FeatureCard = {
  Icon: LucideIcon;
  iconClassName: string;
  title: string;
  description: string;
};

const FEATURE_CARDS: readonly FeatureCard[] = [
  {
    Icon: Zap,
    iconClassName: 'size-8 text-yellow-500',
    title: 'AI-Powered Generation',
    description:
      'Generate your entire store structure, copy, and branding in seconds. Our AI understands your niche and builds a tailored experience.',
  },
  {
    Icon: Palette,
    iconClassName: 'size-8 text-purple-500',
    title: 'Smart Theming',
    description:
      'Upload your logo and watch as our system extracts your brand colors and applies them intelligently across your entire storefront.',
  },
  {
    Icon: ShoppingBag,
    iconClassName: 'size-8 text-blue-500',
    title: 'Inventory Management',
    description:
      'Track stock, manage variants, and get low-stock alerts. Simple enough for beginners, powerful enough for pros.',
  },
  {
    Icon: BarChart,
    iconClassName: 'size-8 text-green-500',
    title: 'Store analytics',
    description:
      'Review store performance, sales and reporting in your dashboard. Advanced reporting depends on your plan and available data.',
  },
  {
    Icon: Smartphone,
    iconClassName: 'size-8 text-pink-500',
    title: 'Mobile First',
    description:
      'Responsive storefronts serve mobile shoppers, while the mobile-admin app helps merchants manage supported business workflows on the go.',
  },
  {
    Icon: Globe,
    iconClassName: 'size-8 text-cyan-500',
    title: 'Domain purchase and management',
    description:
      'Search and buy a domain or connect one you already own, then verify it and manage your primary address. Requires eligible access, payment and DNS setup. Android in-app domain purchasing is not enabled.',
  },
  {
    Icon: CreditCard,
    iconClassName: 'size-8 text-blue-500',
    title: 'Payments and checkout',
    description:
      'Configure supported payment options such as Paystack, Korapay, Credit Direct and pay on delivery. Gateway availability depends on country, currency, merchant eligibility and provider setup.',
  },
  {
    Icon: Truck,
    iconClassName: 'size-8 text-green-500',
    title: 'Shipping and fulfillment',
    description:
      'Configure shipping zones, rates and pickup options, and use supported shipment quote, booking and tracking workflows. Carrier coverage and merchant configuration apply.',
  },
  {
    Icon: ShoppingBag,
    iconClassName: 'size-8 text-yellow-500',
    title: 'Jumia sales channel',
    description:
      'Connect an eligible Jumia account and manage supported marketplace product and order synchronization from Baci. Requires marketplace access, authorization and a healthy provider connection.',
  },
  {
    Icon: FileText,
    iconClassName: 'size-8 text-purple-500',
    title: 'Invoices and receipts',
    description:
      'Create order documents, invoices and receipts, and manage staff-entered orders and payment records. These workflows require the relevant order data and permissions.',
  },
  {
    Icon: Users,
    iconClassName: 'size-8 text-cyan-500',
    title: 'Team permissions',
    description:
      'Invite staff and manage roles, access and account suspension. Team availability and permissions depend on your account and subscription.',
  },
  {
    Icon: ShoppingBag,
    iconClassName: 'size-8 text-blue-500',
    title: 'Bulk catalog imports',
    description:
      'Import supported product CSV files and manage product variants and inventory. Import formats and validation apply.',
  },
  {
    Icon: BarChart,
    iconClassName: 'size-8 text-green-500',
    title: 'Expenses and profit',
    description:
      'Record expenses and review profit information in mobile-admin. Reports depend on complete sales and cost inputs; they do not replace professional accounting or tax advice.',
  },
  {
    Icon: MessageCircle,
    iconClassName: 'size-8 text-pink-500',
    title: 'Customer follow-ups',
    description:
      'Mobile-admin surfaces supported failed and stale unpaid orders for customer follow-up. Use order context to decide the next action; recovery results are not guaranteed.',
  },
  {
    Icon: BarChart,
    iconClassName: 'size-8 text-purple-500',
    title: 'Growth integrations',
    description:
      'Set up supported analytics, advertising and product-feed connections. Each integration requires appropriate access, provider configuration and consent; setup alone does not prove results.',
  },
  {
    Icon: Zap,
    iconClassName: 'size-8 text-cyan-500',
    title: 'Agent-ready commerce: ACP and UCP',
    description:
      'Baci implements Agentic Commerce Protocol (ACP) and Universal Commerce Protocol (UCP) discovery and transaction interfaces, including structured catalog access, carts, checkout sessions and order reads. Enabled capabilities depend on merchant readiness, authorization and payment configuration—not automatic admission to ChatGPT or Google shopping.',
  },
];

export default function FeaturesPage() {
  return (
    <AppBody>
      <div className="flex flex-col min-h-screen bg-background font-sans selection:bg-accent/30">
        <PlatformHeader />
        <main className="flex-1 pt-24 pb-16">
          <section className="container px-4 md:px-6">
            <div className="text-center mb-16 max-w-3xl mx-auto">
              <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
                Commerce tools for your next stage
              </h1>
              <p className="text-xl text-muted-foreground">
                Build your storefront and manage the work behind each sale,
                across supported web and mobile-admin workflows.
              </p>
              <p className="mt-4 text-base text-muted-foreground">
                Our mission is to build the future of commerce in Africa:
                merchant-owned stores that people and authorized AI agents can
                use, with structured discovery and controlled transaction flows.
              </p>
              <p className="mt-4 text-sm text-muted-foreground">
                Availability depends on your plan, country, app platform,
                permissions and provider configuration. Confirm the workflows
                your business needs before migrating.
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {FEATURE_CARDS.map((feature) => (
                <div
                  key={feature.title}
                  className="p-8 rounded-2xl border border-border bg-card hover:shadow-lg transition-shadow"
                >
                  <div className="mb-6 p-3 bg-accent/5 w-fit rounded-xl">
                    <feature.Icon className={feature.iconClassName} />
                  </div>
                  <h2 className="text-xl font-bold mb-3">{feature.title}</h2>
                  <p className="text-muted-foreground leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </main>
        <PlatformFooter />
      </div>
    </AppBody>
  );
}
