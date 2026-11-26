import { PLATFORM_FEATURE_CATEGORIES } from '@/config/platform-features';
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
    '- Public marketing pages are the best source for positioning and packaging details.',
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
  const categoryLines = PLATFORM_FEATURE_CATEGORIES.flatMap((category) => [
    `### ${category.label}`,
    ...category.items.map((item) => `- ${item.title}: ${item.description}`),
    '',
  ]);

  return [
    '# Baci Features',
    '',
    '> Feature summary for the Baci platform—including AI-powered store generation, price negotiations, discount codes, local & crypto payments, mobile admin, and agentic commerce.',
    '',
    '## Capabilities',
    ...categoryLines,
    '## Related Routes',
    `- ${baseUrl}/features`,
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
