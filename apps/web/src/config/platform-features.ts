export type PlatformFeatureSurface = 'Web' | 'Mobile Admin' | 'Storefront';

export type PlatformFeatureIconKey =
  | 'sparkles'
  | 'handshake'
  | 'ticket'
  | 'credit-card'
  | 'smartphone'
  | 'bot'
  | 'gift'
  | 'shopping-cart'
  | 'message-circle'
  | 'star'
  | 'wallet'
  | 'coins'
  | 'send'
  | 'clock'
  | 'piggy-bank'
  | 'building'
  | 'zap'
  | 'palette'
  | 'layout'
  | 'file-spreadsheet'
  | 'search'
  | 'users'
  | 'scan-barcode'
  | 'package'
  | 'receipt'
  | 'file-text'
  | 'bar-chart'
  | 'truck'
  | 'store'
  | 'megaphone'
  | 'rss'
  | 'pen-tool'
  | 'globe'
  | 'arrow-up-right'
  | 'shield-check'
  | 'key-round';

export interface PlatformSpotlightFeature {
  id: string;
  icon: PlatformFeatureIconKey;
  iconClassName: string;
  title: string;
  description: string;
  badge?: string;
}

export interface PlatformFeatureItem {
  id: string;
  icon: PlatformFeatureIconKey;
  title: string;
  description: string;
  surfaces: readonly PlatformFeatureSurface[];
}

export interface PlatformFeatureCategory {
  id: string;
  label: string;
  shortLabel: string;
  tagline: string;
  items: readonly PlatformFeatureItem[];
}

/**
 * Six flagship capabilities highlighted at the top of usebaci.com and /features.
 * Only verified, general-availability platform capabilities belong here—no
 * merchant-specific modules (e.g. Ogabassey-only workflows) and no unshipped stubs.
 */
export const PLATFORM_SPOTLIGHT_FEATURES: readonly PlatformSpotlightFeature[] =
  [
    {
      id: 'ai-store-builder',
      icon: 'sparkles',
      iconClassName: 'size-6 text-accent',
      title: 'AI Storefront & Visual Builder',
      badge: 'AI-Native',
      description:
        'Generate your store structure, logo, brand palette, and copy in seconds—then customize with 29+ drag-and-drop blocks and a Gemini AI command bar.',
    },
    {
      id: 'price-negotiations',
      icon: 'handshake',
      iconClassName: 'size-6 text-emerald-500',
      title: 'Built-in Price Negotiations',
      badge: 'Conversion Booster',
      description:
        'Let shoppers submit single-item or whole-cart offers with margin-protected counter-offers and accept or decline in real time from Mobile Admin.',
    },
    {
      id: 'discounts-vouchers-loyalty',
      icon: 'ticket',
      iconClassName: 'size-6 text-purple-500',
      title: 'Discount Codes, Vouchers & Loyalty',
      description:
        'Launch percentage or fixed-amount promo codes with usage caps, storefront announcement bars, and Bronze-to-Diamond loyalty tiers that drive repeat sales.',
    },
    {
      id: 'payments-bnpl-crypto',
      icon: 'credit-card',
      iconClassName: 'size-6 text-blue-500',
      title: 'Local Payments, BNPL & Crypto',
      description:
        'Accept Paystack, Korapay, Bank Transfers (DVA), Pay-for-Me links, USDT/USDC crypto, CredPal, Credit Direct, Klump, and Ship on Credit.',
    },
    {
      id: 'mobile-admin-app',
      icon: 'smartphone',
      iconClassName: 'size-6 text-pink-500',
      title: 'Mobile Admin Super-App',
      description:
        'Run operations from your phone: scan barcodes, track serialized units, log expenses, follow up on abandoned checkouts via WhatsApp, and export PDF tax ledgers.',
    },
    {
      id: 'agentic-omnichannel',
      icon: 'bot',
      iconClassName: 'size-6 text-amber-500',
      title: 'Agentic Commerce & Omnichannel',
      badge: 'Future-Ready',
      description:
        'Sync stock and orders with Jumia, publish Google, Meta, TikTok & OpenAI shopping feeds, and expose WebMCP and UCP/ACP checkout for AI shopping agents.',
    },
  ];

/**
 * Canonical grouped catalog of general Baci platform capabilities.
 * Consumed by usebaci.com (tabbed toolkit), /features, and /features.md.
 * See docs/PRODUCT_FEATURES.md for the engineering file-path map.
 */
export const PLATFORM_FEATURE_CATEGORIES: readonly PlatformFeatureCategory[] = [
  {
    id: 'sell-convert',
    label: 'Sell & Convert',
    shortLabel: 'Sell & Convert',
    tagline:
      'Turn browsers into buyers with negotiations, promo codes, loyalty tiers, and abandoned-cart recovery.',
    items: [
      {
        id: 'negotiations',
        icon: 'handshake',
        title: 'Price Negotiations ("Haggling")',
        description:
          'Accept single-item or whole-cart offers with automated margin-safe counter-offers, price-match evidence uploads, and instant mobile approvals.',
        surfaces: ['Storefront', 'Mobile Admin'],
      },
      {
        id: 'discount-codes',
        icon: 'ticket',
        title: 'Discount Codes & Promo Vouchers',
        description:
          'Create percentage or fixed-amount codes with minimum spend rules, max discount caps, total/per-customer limits, schedules, and category targeting.',
        surfaces: ['Web', 'Mobile Admin'],
      },
      {
        id: 'loyalty-tiers',
        icon: 'gift',
        title: 'Tiered Loyalty & Rewards',
        description:
          'Reward purchases, signups, birthdays, reviews, and referrals with Bronze-to-Diamond tiers, points multipliers, and checkout redemption rules.',
        surfaces: ['Web', 'Storefront'],
      },
      {
        id: 'smart-cart',
        icon: 'shopping-cart',
        title: 'Smart Cart, Gifting & Live Repricing',
        description:
          'Detect live catalog price changes before checkout, let shoppers gift cart items with custom messages, and compare up to 3 products side by side.',
        surfaces: ['Storefront'],
      },
      {
        id: 'abandoned-followup',
        icon: 'message-circle',
        title: 'Abandoned Checkout Follow-Up Queue',
        description:
          'Spot failed payments, BNPL drop-offs, and expired transfers in a badged mobile queue with gateway error context and 1-tap WhatsApp or phone outreach.',
        surfaces: ['Mobile Admin'],
      },
      {
        id: 'reviews-wishlists',
        icon: 'star',
        title: 'Verified Reviews, Wishlists & Social Proof',
        description:
          'Moderate verified buyer reviews, sync Google Business Profile ratings, enable customer wishlists, and show recent purchase social proof.',
        surfaces: ['Web', 'Storefront'],
      },
    ],
  },
  {
    id: 'payments-fintech',
    label: 'Payments & Fintech',
    shortLabel: 'Payments',
    tagline:
      'Give every shopper a way to pay—from instant bank transfers and BNPL to crypto and target savings.',
    items: [
      {
        id: 'multi-gateway',
        icon: 'credit-card',
        title: 'Paystack, Korapay & Bank Transfer (DVA)',
        description:
          'Accept cards, USSD, dedicated virtual bank accounts, and Pay on Delivery with automated webhook reconciliation and weekly merchant auto-payouts.',
        surfaces: ['Web', 'Storefront'],
      },
      {
        id: 'bnpl-providers',
        icon: 'wallet',
        title: 'Buy Now, Pay Later (3 Providers)',
        description:
          'Offer instant installment checkout through CredPal, Credit Direct, and Klump with server-signed sessions and mobile WebView support.',
        surfaces: ['Storefront', 'Mobile Admin'],
      },
      {
        id: 'crypto-checkout',
        icon: 'coins',
        title: 'Crypto Payments (USDT & USDC)',
        description:
          'Accept stablecoin checkout and wallet funding via Juicyway across TRX, ETH, MATIC, and AVAXC with live QR codes and verification polling.',
        surfaces: ['Storefront'],
      },
      {
        id: 'pay-for-me-invoices',
        icon: 'send',
        title: 'Pay-for-Me Links & Instant Invoices',
        description:
          'Let shoppers generate a shareable Pay-for-Me checkout link or branded invoice PDF so friends, family, or finance teams can complete payment.',
        surfaces: ['Storefront', 'Mobile Admin'],
      },
      {
        id: 'ship-on-credit',
        icon: 'clock',
        title: 'Ship on Credit (Deferred Virtual Account)',
        description:
          'Dispatch trusted orders before payment and automatically generate a dedicated virtual bank account so settlement reconciles when the customer pays.',
        surfaces: ['Mobile Admin'],
      },
      {
        id: 'save-to-buy',
        icon: 'piggy-bank',
        title: 'Save-to-Buy Target Savings Goals',
        description:
          'Let customers save toward a product over time with Paystack recurring auto-debit, manual top-ups, pause/resume controls, and target swaps.',
        surfaces: ['Storefront'],
      },
      {
        id: 'virtual-terminals',
        icon: 'building',
        title: 'Branch & Staff Virtual Terminals',
        description:
          'Issue Paystack Virtual Terminals and dedicated payment accounts per branch or staff member with real-time payment alerts.',
        surfaces: ['Web', 'Mobile Admin'],
      },
      {
        id: 'vtu-commissions',
        icon: 'zap',
        title: 'VTU Airtime, Data & Utility Bills',
        description:
          'Sell airtime, mobile data, cable TV, and electricity directly from your storefront via Kuda and earn commissions on every transaction.',
        surfaces: ['Web', 'Storefront'],
      },
    ],
  },
  {
    id: 'ai-builder',
    label: 'AI & Store Builder',
    shortLabel: 'AI & Builder',
    tagline:
      'Go from idea to a customized, AI-discoverable storefront in minutes without writing a line of code.',
    items: [
      {
        id: 'ai-store-generation',
        icon: 'sparkles',
        title: 'AI-Powered Store Generation',
        description:
          'Answer a few questions about your business to generate your storefront structure, copy, branding, and curated homepage automatically.',
        surfaces: ['Web'],
      },
      {
        id: 'branding-bg-removal',
        icon: 'palette',
        title: 'AI Logo, Background Removal & Smart Theming',
        description:
          'Generate business names and logos with AI, strip image backgrounds right in the browser, and extract matching brand color palettes automatically.',
        surfaces: ['Web'],
      },
      {
        id: 'puck-visual-builder',
        icon: 'layout',
        title: 'Visual Builder (29+ Blocks) & AI Command Bar',
        description:
          'Edit Mobile, Tablet, and Desktop layouts with drag-and-drop blocks, theme/CSS controls, a Gemini natural-language command bar, and CopilotKit.',
        surfaces: ['Web', 'Mobile Admin'],
      },
      {
        id: 'price-list-sheets',
        icon: 'file-spreadsheet',
        title: 'AI Price-List Paste & Google Sheets Sync',
        description:
          'Paste raw WhatsApp or text price lists for AI parsing into staged products, upload CSVs, or link a live Google Sheet to keep inventory synced.',
        surfaces: ['Web'],
      },
      {
        id: 'ai-seo-enrichment',
        icon: 'search',
        title: 'AI Product Enrichment, SEO & FAQ Builder',
        description:
          'Batch-generate SEO descriptions, SKUs, attributes, meta tags, and storefront FAQs, and fill missing product images in one workflow.',
        surfaces: ['Web'],
      },
      {
        id: 'agentic-commerce',
        icon: 'bot',
        title: 'Agentic Commerce (UCP/ACP & WebMCP)',
        description:
          'Expose /agent-commerce.json, /agent-trust.json, WebMCP browser tools, LLM .md pages, and signed agentic checkout sessions with crawler controls.',
        surfaces: ['Web', 'Storefront'],
      },
    ],
  },
  {
    id: 'operations-mobile',
    label: 'Operations & Mobile Admin',
    shortLabel: 'Operations',
    tagline:
      'Inventory, multi-branch teams, expenses, profit tracking, and shipping—engineered for mobile-first merchants.',
    items: [
      {
        id: 'branches-staff',
        icon: 'users',
        title: 'Multi-Branch Switching & 8-Role Staff RBAC',
        description:
          'Scope dashboards, orders, and expenses by branch and invite team members across 8 roles (Admin, Manager, Sales, Inventory, Accountant, Support, Marketing, Fulfillment).',
        surfaces: ['Web', 'Mobile Admin'],
      },
      {
        id: 'barcode-scanner',
        icon: 'scan-barcode',
        title: 'Native Camera Barcode & SKU Scanner',
        description:
          'Scan QR, EAN, UPC, or Code128/39/93 barcodes with your phone camera to jump straight to a product or pre-fill SKUs during stock intake.',
        surfaces: ['Mobile Admin'],
      },
      {
        id: 'serialized-units',
        icon: 'package',
        title: 'Serialized Unit Inventory & Batch Restock',
        description:
          'Restock and track serialized inventory units by branch and source, scan serials during dispatch, and inspect individual unit status.',
        surfaces: ['Mobile Admin'],
      },
      {
        id: 'expenses-profit',
        icon: 'receipt',
        title: 'Expenses, Profit Review & Item Reconciliation',
        description:
          'Log business expenses with receipt photos, inline-edit missing cost prices to see true monthly profit, and reconcile unlinked custom order items.',
        surfaces: ['Mobile Admin'],
      },
      {
        id: 'pdf-reports',
        icon: 'file-text',
        title: 'CSV/PDF Order, Executive & Tax Ledger Reports',
        description:
          'Generate and share branded PDF invoices, receipts, filtered order summaries, Executive Summaries, and Tax Ledger reports directly from your phone.',
        surfaces: ['Mobile Admin'],
      },
      {
        id: 'forecasting-rfm',
        icon: 'bar-chart',
        title: 'Demand Forecasting, Reorder Alerts & RFM CRM',
        description:
          'Monitor sales-velocity inventory forecasts, low-stock push alerts, reorder suggestions, and automated RFM customer segmentation.',
        surfaces: ['Web'],
      },
      {
        id: 'shipping-logistics',
        icon: 'truck',
        title: 'GIGL, Topship, Airport & Pickup Delivery',
        description:
          'Offer live multi-carrier shipping quotes, self-fulfillment, airport delivery, pickup stations, rider WhatsApp handoff, and live tracking.',
        surfaces: ['Web', 'Storefront', 'Mobile Admin'],
      },
    ],
  },
  {
    id: 'growth-compliance',
    label: 'Growth, Domains & Compliance',
    shortLabel: 'Growth & Trust',
    tagline:
      'Own your domain, sync ad spend and marketplaces, migrate existing orders, and stay tax-compliant.',
    items: [
      {
        id: 'jumia-sync',
        icon: 'store',
        title: 'Jumia Marketplace Integration',
        description:
          'Connect your Jumia Seller Center account via OAuth to import/export products, synchronize stock levels, and manage orders in one place.',
        surfaces: ['Web', 'Mobile Admin'],
      },
      {
        id: 'ad-capi-roas',
        icon: 'megaphone',
        title: 'Ad Pixels, Server-Side CAPI & Spend ROAS',
        description:
          'Connect Meta, Google GA4/Ads, TikTok, and Snapchat via OAuth for daily ad spend sync, server-side Conversions API, and Safari ITP-safe 90-day attribution.',
        surfaces: ['Web', 'Mobile Admin'],
      },
      {
        id: 'shopping-feeds',
        icon: 'rss',
        title: 'Google, Meta, TikTok & OpenAI Product Feeds',
        description:
          'Publish verified XML and JSONL product feeds automatically so your catalog stays indexed across shopping ads and AI search engines.',
        surfaces: ['Web'],
      },
      {
        id: 'blog-cms',
        icon: 'pen-tool',
        title: 'Built-in Blog Engine (Google Discover Ready)',
        description:
          'Publish SEO-optimized articles with embedded products, E-E-A-T author profiles, AI rewriting, RSS feeds, and Zoho Campaigns email sync.',
        surfaces: ['Web', 'Mobile Admin'],
      },
      {
        id: 'domains-email',
        icon: 'globe',
        title: 'In-App Domains & Custom Sender Email',
        description:
          'Search and buy custom domains via Paystack with automatic SSL, DNS/WHOIS management, and verified custom sender email domains (noreply@yourstore.com).',
        surfaces: ['Web', 'Mobile Admin'],
      },
      {
        id: 'bumpa-migration',
        icon: 'arrow-up-right',
        title: 'Bumpa CSV Migration & Receipt-Claim Campaigns',
        description:
          'Import historical orders and products from Bumpa CSVs and send customers automated claim links so their past receipts attach to their new accounts.',
        surfaces: ['Web'],
      },
      {
        id: 'kyc-tax-firs',
        icon: 'shield-check',
        title: 'Nigerian KYC (NIN/BVN/CAC) & 7.5% VAT / FIRS',
        description:
          'Verify NIN, BVN, and CAC records in-app, configure 7.5% VAT collection, verify your FIRS TIN, and publish structured trust and return policies.',
        surfaces: ['Web', 'Mobile Admin'],
      },
      {
        id: 'passkeys-2fa',
        icon: 'key-round',
        title: 'Passkeys, Authenticator 2FA & Recovery Codes',
        description:
          'Protect merchant and staff accounts with WebAuthn passkeys, TOTP authenticator apps, one-time recovery codes, and full order audit trails.',
        surfaces: ['Web', 'Mobile Admin'],
      },
    ],
  },
];
