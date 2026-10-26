export interface CategoryGuideCopyItem {
  id: string;
  text: string;
}

export interface CategoryGuideCopy {
  bullets: CategoryGuideCopyItem[];
  heading: string;
  paragraphs: CategoryGuideCopyItem[];
}

export function buildGuideCopyItems(
  prefix: string,
  items: string[]
): CategoryGuideCopyItem[] {
  return items.map((text, index) => ({
    id: `${prefix}-${index + 1}`,
    text,
  }));
}

function createGuide(
  heading: string,
  paragraphs: string[],
  bullets: string[],
  prefix: string
): CategoryGuideCopy {
  return {
    heading,
    paragraphs: buildGuideCopyItems(`${prefix}-paragraph`, paragraphs),
    bullets: buildGuideCopyItems(`${prefix}-bullet`, bullets),
  };
}

export function normalizeCategoryKey(category: string): string {
  return category
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const CATEGORY_ALIASES: Record<string, string> = {
  reviews: 'review',
  smartphone: 'smartphones',
  laptop: 'laptops',
  tablet: 'tablets',
  wearable: 'wearables',
  accessory: 'accessories',
  'buying-guide': 'buying-guides',
  technews: 'tech-news',
  'how-to': 'how-to-guides',
  'how-to-guide': 'how-to-guides',
  tips: 'tips-and-tricks',
  'tips-and-trick': 'tips-and-tricks',
  repair: 'repairs',
};

const OGABASSEY_CATEGORY_GUIDES: Record<string, CategoryGuideCopy> = {
  deals: createGuide(
    'How to use Ogabassey deals articles',
    [
      'This archive gathers Ogabassey deals coverage for shoppers comparing phones, laptops, gaming accessories and everyday gadgets in Nigeria. Use it to understand what changed in a promotion, which specifications matter before a discount looks attractive, and when a lower price may still need a warranty, condition or storage check.',
      'The articles are grouped with recent posts first so you can move from offer context to product research quickly. Check the RAM, storage, battery, display, chipset, return terms and delivery details mentioned in each story before selecting a deal.',
    ],
    [
      'Compare the discounted price against the exact variant.',
      'Confirm condition, warranty and return terms before checkout.',
      'Use specs and delivery notes to avoid false bargains.',
    ],
    'deals'
  ),
  news: createGuide(
    'How to use Ogabassey news articles',
    [
      'This news archive covers product launches, availability updates, software changes and market signals that can affect electronics buyers in Nigeria. Ogabassey uses these posts to explain why a new phone, laptop, console or accessory matters before it appears as a product listing or comparison option.',
      'Read the latest stories first, then follow the related categories when you need buying context. News articles are most useful when you want release timing, feature changes, official pricing direction, stock expectations or a quick explanation of what has changed since an older model.',
    ],
    [
      'Track launches and availability before comparing prices.',
      'Use news context to understand model changes and upgrades.',
      'Check related guides when you are ready to buy.',
    ],
    'news'
  ),
  'platform-comparisons': createGuide(
    'How to use Ogabassey platform comparison articles',
    [
      'Platform comparison articles help shoppers choose between ecosystems before choosing a specific device. Ogabassey uses this category for iOS versus Android decisions, gaming and streaming platform trade-offs, laptop operating-system choices, app support, accessory compatibility and long-term ownership considerations.',
      'Use these articles when the main question is not only price, but which platform fits your workflow, repairs, resale value, updates, payments, cloud services and existing devices. The goal is to make the product shortlist smaller before you compare individual specifications.',
    ],
    [
      'Compare ecosystems before comparing individual product models.',
      'Review app, accessory and update support for Nigeria.',
      'Use platform fit to narrow your final buying shortlist.',
    ],
    'platform-comparisons'
  ),
  'product-guides': createGuide(
    'How to use Ogabassey product guide articles',
    [
      'Product guide articles are built for shoppers who need practical buying help before choosing a phone, laptop, console, accessory or repair option. Ogabassey focuses these guides on the details that usually decide value: RAM, storage, chipset, battery life, display quality, camera needs, ports, warranty and after-sales support.',
      'Start here when a product category feels crowded or when two variants look similar. The guides explain which specifications matter for students, creators, gamers, office users and everyday buyers, then point you toward the right category or comparison path.',
    ],
    [
      'Use guide criteria before sorting only by price.',
      'Match specs to your real use case and budget.',
      'Check variant details before comparing stock listings.',
    ],
    'product-guides'
  ),
  review: createGuide(
    'How to use Ogabassey review articles',
    [
      'Review articles collect practical impressions, trade-offs and buying notes for electronics shoppers who want more than a spec sheet. Ogabassey uses this category to discuss what a device or accessory is good at, where it may compromise, and which buyer profile should consider it.',
      'Use review posts after you already know the broad category you want. They are designed to help you weigh performance, camera quality, battery endurance, display comfort, build quality, repairability, software support and overall value before moving to a product page.',
    ],
    [
      'Read reviews after narrowing your category choice.',
      'Look for trade-offs, not only headline specifications.',
      'Compare review notes with the exact variant in stock.',
    ],
    'review'
  ),
  'smartphone-comparisons': createGuide(
    'How to use Ogabassey smartphone comparison articles',
    [
      'Smartphone comparison articles are for buyers deciding between similar phones, storage variants, camera systems, chipsets or brands. Ogabassey uses this category to compare Android and iPhone options, budget and flagship models, battery sizes, display refresh rates, charging speeds and software support.',
      'Use these comparisons when two phones look close on price but differ in everyday experience. The right choice often depends on RAM, storage, network support, camera processing, update policy, repair cost, battery health and whether the exact variant is available in Nigeria.',
    ],
    [
      'Compare exact RAM and storage variants before choosing.',
      'Check battery, display, chipset and camera trade-offs.',
      'Use availability and support notes for Nigeria-specific decisions.',
    ],
    'smartphone-comparisons'
  ),
  smartphones: createGuide(
    'How to use Ogabassey smartphone articles',
    [
      'This archive covers smartphone reviews, flagship launches, and budget-friendly picks for shoppers in Nigeria. Ogabassey uses these articles to break down camera capabilities, battery life during power cuts, network compatibility across local telcos, and real-world processor performance before you commit to a purchase.',
      'Scan the newest guides first to compare iOS and Android options, storage tiers, and charging speeds. Each article pairs hands-on specifications with local market realities like warranty coverage, swap options, and screen replacement costs so you can make an informed choice.',
    ],
    [
      'Check battery endurance and fast charging for everyday Nigerian reliability.',
      'Confirm internal storage and 5G network band support before ordering.',
      'Compare local warranty terms and swap eligibility across phone brands.',
    ],
    'smartphones'
  ),
  laptops: createGuide(
    'How to use Ogabassey laptop articles',
    [
      'This collection gathers laptop guides, teardowns, and productivity advice for students, tech professionals, and creators working in Nigeria. Ogabassey uses these articles to compare Apple MacBooks, Windows ultrabooks, and workhorse machines across battery endurance, thermal management, keyboard durability, and port selection.',
      'Use these posts to choose between new and certified pre-owned units, understand processor tiers from Intel, AMD, and Apple Silicon, and verify whether a machine handles heavy workloads without throttling in tropical ambient temperatures.',
    ],
    [
      'Prioritize battery life and USB-C charging for mobile power reliability.',
      'Match RAM and storage capacity to coding, creative, or office workloads.',
      'Inspect keyboard layout, screen brightness, and port availability.',
    ],
    'laptops'
  ),
  gaming: createGuide(
    'How to use Ogabassey gaming articles',
    [
      'This archive brings together console breakdowns, gaming laptop comparisons, handheld reviews, and peripheral advice for gamers in Nigeria. Ogabassey covers PlayStation, Xbox, Nintendo Switch, and PC gaming hardware with a focus on local pricing, game availability, and power supply safeguards.',
      'Read these posts to understand frame rate stability, storage expansion options like NVMe SSDs, digital store region setups, and the best display settings to pair with your setup for competitive play.',
    ],
    [
      'Verify console storage expansion and digital account setup for Nigeria.',
      'Check refresh rate, HDMI 2.1, and VRR support for modern console gaming.',
      'Use surge protectors and UPS advice to safeguard gaming rigs from power fluctuations.',
    ],
    'gaming'
  ),
  'buying-guides': createGuide(
    'How to use Ogabassey buying guide articles',
    [
      'Ogabassey buying guides walk shoppers through structured decision frameworks across gadgets, consumer electronics, and home entertainment. Rather than pushing single products, these guides explain what features truly matter at each budget tier so you avoid overspending on specs you will not use.',
      'Start here when researching a major upgrade or gift. The guides outline minimum recommended specifications, typical trade-offs between budget and premium tiers, and how to verify legitimate merchant inventory in Nigeria.',
    ],
    [
      'Follow clear budget tiers to balance price against everyday performance.',
      'Identify core must-have specs versus marketing gimmicks.',
      'Consult condition checklists when choosing between brand-new and open-box items.',
    ],
    'buying-guides'
  ),
  'tech-news': createGuide(
    'How to use Ogabassey tech news articles',
    [
      'This section tracks global device announcements, local consumer technology developments, exchange rate impacts, and telecom updates affecting Nigerian consumers. Ogabassey curates news to explain how international tech trends translate into local availability and price shifts.',
      'Browse the latest stories to stay ahead of upcoming product cycles, planned price revisions, operating system rollouts, and regulatory updates that affect device warranties and grey-market imports in Nigeria.',
    ],
    [
      'Monitor international release schedules to time your local purchases.',
      'Understand currency shifts and import trends influencing gadget prices.',
      'Learn about software patches and warranty policies as soon as they drop.',
    ],
    'tech-news'
  ),
  accessories: createGuide(
    'How to use Ogabassey accessories articles',
    [
      'This category gathers buyer advice on chargers, power banks, protective cases, cables, screen protectors, and audio adapters for electronics in Nigeria. Ogabassey tests accessories to ensure they deliver certified charging standards and physical protection without damaging delicate hardware.',
      'Use these articles to identify genuine GaN fast chargers, verify USB-C Power Delivery wattages, select durable screen protection for curved displays, and choose high-capacity power banks suited to Nigerian power schedules.',
    ],
    [
      'Match charger wattage and protocols to your phone or laptop battery specs.',
      'Choose verified power banks with fast input recharging and safety protections.',
      'Confirm genuine brand certification to protect devices from power surges.',
    ],
    'accessories'
  ),
  tablets: createGuide(
    'How to use Ogabassey tablet articles',
    [
      'This guide archive focuses on iPads, Android tablets, and drawing slates for work, digital illustration, university study, and media consumption in Nigeria. Ogabassey breaks down stylus support, keyboard compatibility, screen clarity, and multitasking performance.',
      'Consult these articles to decide whether a tablet can replace your laptop for daily tasks, compare cellular LTE/5G models against Wi-Fi configurations, and find the right screen size for commuting or desk setups.',
    ],
    [
      'Compare Apple iPad, Samsung Galaxy Tab, and budget slate capabilities.',
      'Assess pencil latency, keyboard accessories, and productivity modes.',
      'Evaluate cellular versus Wi-Fi models based on your mobility needs.',
    ],
    'tablets'
  ),
  wearables: createGuide(
    'How to use Ogabassey wearable articles',
    [
      'This archive covers smartwatches, fitness bands, and smart rings designed to track health, fitness, and notifications on the go. Ogabassey tests battery endurance, heart-rate accuracy, GPS tracking in urban Nigerian cities, and companion app compatibility.',
      'Read these posts to balance premium titanium and sapphire builds against budget trackers, verify water resistance ratings for exercise, and understand battery life expectations between daily-charge watches and multi-week bands.',
    ],
    [
      'Check operating system pairing with your current smartphone.',
      'Evaluate real-world battery life under continuous health tracking.',
      'Verify water resistance and durability for workouts and outdoor use.',
    ],
    'wearables'
  ),
  repairs: createGuide(
    'How to use Ogabassey repair articles',
    [
      'This archive provides troubleshooting breakdowns, DIY triage advice, and professional service guidance for cracked screens, swollen batteries, water exposure, and charging port faults. Ogabassey outlines realistic repair costs and genuine parts availability across Lagos and nationwide.',
      'Use these guides to determine whether a faulty device is worth repairing or if upgrading offers better value. Articles explain OEM part distinctions, turnaround times, and data security precautions before handing a device over to technicians.',
    ],
    [
      'Assess whether repair costs make financial sense against device replacement value.',
      'Insist on genuine OEM screens and batteries to maintain safety and longevity.',
      'Back up personal data and remove account locks before booking technical service.',
    ],
    'repairs'
  ),
  'how-to-guides': createGuide(
    'How to use Ogabassey how-to guide articles',
    [
      'Our how-to guides deliver step-by-step instructions for setting up new devices, optimizing battery endurance, transferring data across ecosystems, and securing your accounts. Ogabassey writes these walkthroughs with straightforward advice tailored for Nigerian users.',
      'Explore these tutorials to resolve common tech snags, configure dual SIM and eSIM profiles, set up secure payment apps, and clear system storage when your phone or laptop runs low on space.',
    ],
    [
      'Follow sequential steps to migrate WhatsApp, photos, and contacts seamlessly.',
      'Configure power saving and data conservation modes for Nigerian networks.',
      'Implement two-factor authentication and device tracking for theft security.',
    ],
    'how-to-guides'
  ),
  'tips-and-tricks': createGuide(
    'How to use Ogabassey tips and tricks articles',
    [
      'This collection gathers hidden features, camera hacks, productivity shortcuts, and maintenance habits that extend device longevity. Ogabassey curates practical shortcuts that help you unlock the full value of premium and everyday electronics.',
      'Browse these tips to learn advanced camera portrait tricks, keyboard shortcut routines, battery health preservation guidelines, and storage management techniques that keep devices running fast year after year.',
    ],
    [
      'Adopt healthy charging habits to extend lithium battery lifespan.',
      'Leverage hidden OS shortcuts to speed up daily work and communication.',
      'Optimize camera settings for indoor, low-light, and portrait photography.',
    ],
    'tips-and-tricks'
  ),
};

export function getOgabasseyCategoryGuideCopy(
  category: string
): CategoryGuideCopy | null {
  const categoryKey = normalizeCategoryKey(category);
  const guideKey = CATEGORY_ALIASES[categoryKey] ?? categoryKey;
  return OGABASSEY_CATEGORY_GUIDES[guideKey] ?? null;
}
