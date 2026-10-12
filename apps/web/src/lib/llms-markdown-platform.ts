import { normalizeOrigin } from '@/lib/normalize-origin';

export function buildPlatformHomeMarkdown(origin: string): string {
  const baseUrl = normalizeOrigin(origin);

  return [
    '# Baci',
    '',
    '> Baci is an AI-native commerce platform for merchants. It helps businesses launch storefronts, manage products, process payments, and operate from a unified dashboard.',
    '',
    '## Summary',
    '- Merchant-facing platform for store creation, catalog management, and operations.',
    '- Core platform surfaces: onboarding, pricing, features, login, dashboard, builder.',
    '- Public marketing pages summarize positioning; omissions are not evidence that a capability is absent.',
    '- Baci is building agent-native commerce infrastructure for African merchants; its mission is not a claim of measured merchant outcomes.',
    '',
    '## Primary Routes',
    `- ${baseUrl}/onboarding`,
    `- ${baseUrl}/pricing`,
    `- ${baseUrl}/features`,
    `- ${baseUrl}/login`,
    `- ${baseUrl}/dashboard`,
    '',
    '## Notes',
    '- `/dashboard` and many `/api/*` routes are authenticated.',
    '- Use `/openapi.json` and `/sitemap.xml` for machine-readable references.',
    '',
  ].join('\n');
}

export function buildPlatformPricingMarkdown(origin: string): string {
  const baseUrl = normalizeOrigin(origin);

  return [
    '# Baci Pricing',
    '',
    '> Pricing summary for the Baci platform.',
    '',
    '## Plans',
    '- Free: NGN 0. Best for testing ideas and small hobby shops. Includes 1 store, up to 10 products, basic storefront, Baci subdomain, and standard support.',
    '- Pro: NGN 5,000 per month. For growing businesses. Includes unlimited products, custom domain, advanced analytics, priority support, marketing tools, and no transaction fees.',
    '- Premium: NGN 15,000 per month. For scaling enterprises. Includes everything in Pro, multiple staff accounts, advanced reports, dedicated account management, API access, and wholesale features.',
    '',
    '## Related Routes',
    `- ${baseUrl}/onboarding`,
    `- ${baseUrl}/contact`,
    '',
  ].join('\n');
}

export function buildPlatformFeaturesMarkdown(origin: string): string {
  const baseUrl = normalizeOrigin(origin);

  return [
    '# Baci Features',
    '',
    '> Feature summary for the Baci platform.',
    '',
    '## Capabilities',
    '- AI-powered store generation: generate structure, copy, and branding from business inputs.',
    '- Smart theming: derive and apply brand colors from uploaded assets.',
    '- Inventory management: manage products, variants, and stock alerts.',
    '- Store analytics: review performance, sales and reporting with available data and plan access.',
    '- Mobile-first storefronts: responsive experiences optimized for mobile shoppers.',
    '- Domain purchase and management: search, register or connect domains; eligibility, payment and DNS setup apply. Android in-app purchasing is not enabled.',
    '- Payments and checkout: configure supported Paystack, Korapay, Credit Direct and pay-on-delivery options; country, currency, provider and merchant configuration apply.',
    '- Shipping and fulfillment: supported zones, rates, pickup, quotes, booking and tracking workflows; carrier coverage and configuration apply.',
    '- Jumia sales channel: authorized marketplace product and order synchronization, subject to access and provider connection.',
    '- Invoices and receipts: order documents, staff-entered orders and payment records with relevant permissions.',
    '- Team permissions: roles, access and suspension, subject to subscription and permissions.',
    '- Bulk catalog imports: supported CSV import, variants and inventory; format and validation rules apply.',
    '- Mobile-admin: supported expense/profit reporting and failed or stale unpaid-order follow-ups; complete inputs and permissions required.',
    '- Growth integrations: supported analytics, advertising and feeds; provider setup and consent apply, without guaranteed results.',
    '- Agent-ready commerce: ACP and UCP discovery, structured catalog access, carts, checkout sessions and order reads. Capability readiness and signed authorization apply; not automatic ChatGPT or Google shopping admission.',
    '',
    '## Agent Access Boundaries',
    '- This feature summary is not a list of callable MCP tools or protocol certification.',
    '- Buyer-facing shopping and merchant/admin tools have different identities, tenants and permissions. Discover actual tools from the relevant connector; do not infer tool availability from dashboard features.',
    '- Sensitive purchases and merchant writes require explicit authorization and supported approval flows. Product assistance is not unconstrained autonomous operation.',
    '',
    '## Related Routes',
    `- ${baseUrl}/pricing`,
    `- ${baseUrl}/onboarding`,
    '',
  ].join('\n');
}

export function buildPlatformOnboardingMarkdown(origin: string): string {
  const baseUrl = normalizeOrigin(origin);

  return [
    '# Baci Onboarding',
    '',
    '> Onboarding starts the AI-assisted flow for creating a merchant storefront and configuring initial business details.',
    '',
    '## What This Route Does',
    '- Collects merchant and business information.',
    '- Starts the AI-assisted store setup flow.',
    '- Leads into authenticated setup and builder flows.',
    '',
    '## Related Routes',
    `- ${baseUrl}/pricing`,
    `- ${baseUrl}/login`,
    `- ${baseUrl}/dashboard`,
    '',
    '## Notes',
    '- This route leads to stateful account creation and setup actions.',
    '',
  ].join('\n');
}
