import type { CategoryNavItem } from '@/lib/cached-categories';
import type { JsonLdGraphData, JsonLdGraphNode } from '@/lib/json-ld-types';
import type { Product } from '@/lib/products';
import { getProductUrl } from '@/lib/seo-utils';

const DEFAULT_CATEGORY_LIMIT = 12;
const DEFAULT_PRODUCT_LINK_LIMIT = 8;
interface StorefrontHomeSemanticGraphInput {
  additionalTopics?: string[];
  baseUrl: string;
  blogEnabled?: boolean;
  categories: CategoryNavItem[];
  collectionSchema?: Record<string, unknown> | null;
  description: string;
  identityGraph: Record<string, unknown>;
  merchantName: string;
  products: Product[];
  topicalFocus?: string;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isJsonLdGraphNode(value: unknown): value is JsonLdGraphNode {
  return (
    isRecord(value) &&
    (typeof value['@type'] === 'string' || typeof value['@id'] === 'string')
  );
}
function stripContext(
  schema: Record<string, unknown>
): Record<string, unknown> {
  const { '@context': _context, ...rest } = schema;
  return rest;
}
function normalizeBaseUrl(baseUrl: string): string {
  try {
    const parsedUrl = new URL(baseUrl);
    const path = parsedUrl.pathname.replace(/\/+$/g, '');
    return `${parsedUrl.origin}${path === '/' ? '' : path}`;
  } catch {
    return baseUrl.replace(/\/+$/g, '');
  }
}
function storeUrl(baseUrl: string, path = ''): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedPath = path.trim();
  if (!normalizedPath || normalizedPath === '/') {
    return normalizedBaseUrl;
  }
  if (/^https?:\/\//i.test(normalizedPath)) {
    try {
      const parsedUrl = new URL(normalizedPath);
      return parsedUrl.toString().replace(/\/+$/g, '');
    } catch {
      return normalizedPath;
    }
  }

  return `${normalizedBaseUrl}/${normalizedPath.replace(/^\/+/, '')}`;
}

function schemaId(baseUrl: string, fragment: string): string {
  return `${storeUrl(baseUrl)}/#${fragment}`;
}

function getIdentityGraphNodes(
  identityGraph: Record<string, unknown>
): JsonLdGraphNode[] {
  const graph = identityGraph['@graph'];
  if (Array.isArray(graph)) {
    return graph
      .filter(isJsonLdGraphNode)
      .map(stripContext)
      .filter(isJsonLdGraphNode);
  }

  const node = stripContext(identityGraph);
  return isJsonLdGraphNode(node) ? [node] : [];
}

function withIdentityIds(
  nodes: JsonLdGraphNode[],
  baseUrl: string
): JsonLdGraphNode[] {
  const onlineStoreId = schemaId(baseUrl, 'online-store');
  const physicalStoreId = schemaId(baseUrl, 'physical-store');
  const websiteId = schemaId(baseUrl, 'website');

  return nodes.map((node) => {
    const type = node['@type'];
    if (type === 'OnlineStore') {
      return { ...node, '@id': onlineStoreId };
    }

    if (type === 'Store') {
      return {
        ...node,
        '@id': physicalStoreId,
        parentOrganization: { '@id': onlineStoreId },
      };
    }

    if (type === 'WebSite') {
      return { ...node, '@id': websiteId };
    }

    return node;
  });
}

function normalizeCategoryLinks(categories: CategoryNavItem[]) {
  const seenSlugs = new Set<string>();
  const normalizedCategories: CategoryNavItem[] = [];

  for (const category of categories) {
    const slug = category.slug.trim().replace(/^\/+|\/+$/g, '');
    const name = category.name.trim();

    if (!slug || !name || seenSlugs.has(slug)) {
      continue;
    }

    seenSlugs.add(slug);
    normalizedCategories.push({ name, slug });
  }

  return normalizedCategories.slice(0, DEFAULT_CATEGORY_LIMIT);
}

function buildAboutTopics(input: StorefrontHomeSemanticGraphInput) {
  const topicNames = new Set<string>();

  if (input.topicalFocus?.trim()) {
    topicNames.add(input.topicalFocus.trim());
  }

  for (const topic of input.additionalTopics ?? []) {
    if (topic.trim()) {
      topicNames.add(topic.trim());
    }
  }

  for (const category of input.categories.slice(0, 6)) {
    if (category.name.trim()) {
      topicNames.add(category.name.trim());
    }
  }

  return [...topicNames].map((name) => ({
    '@type': 'Thing',
    name,
  }));
}

function buildCategoryHubList(
  input: StorefrontHomeSemanticGraphInput,
  categories: CategoryNavItem[]
): Record<string, unknown> | null {
  if (categories.length === 0) {
    return null;
  }

  return {
    '@type': 'ItemList',
    '@id': schemaId(input.baseUrl, 'category-hubs'),
    name: `${input.merchantName} category hubs`,
    itemListElement: categories.map((category, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'CollectionPage',
        '@id': `${storeUrl(input.baseUrl, category.slug)}#collection`,
        name: category.name,
        url: storeUrl(input.baseUrl, category.slug),
      },
    })),
  };
}

function buildNavigationNode(
  input: StorefrontHomeSemanticGraphInput,
  categories: CategoryNavItem[]
): Record<string, unknown> {
  const navigationEntries = [
    {
      '@type': 'CollectionPage',
      name: 'All products',
      url: storeUrl(input.baseUrl, 'products'),
    },
    ...categories.map((category) => ({
      '@type': 'CollectionPage',
      name: category.name,
      url: storeUrl(input.baseUrl, category.slug),
    })),
  ];

  if (input.blogEnabled) {
    navigationEntries.push({
      '@type': 'Blog',
      name: `${input.merchantName} blog`,
      url: storeUrl(input.baseUrl, 'blog'),
    });
  }

  return {
    '@type': 'SiteNavigationElement',
    '@id': schemaId(input.baseUrl, 'site-navigation'),
    name: `${input.merchantName} storefront navigation`,
    hasPart: navigationEntries,
  };
}

function buildProductSignificantLinks(input: StorefrontHomeSemanticGraphInput) {
  return input.products
    .slice(0, DEFAULT_PRODUCT_LINK_LIMIT)
    .map((product) => storeUrl(input.baseUrl, getProductUrl(product)));
}

function buildCollectionNode(
  input: StorefrontHomeSemanticGraphInput,
  categories: CategoryNavItem[],
  categoryHubList: Record<string, unknown> | null
): Record<string, unknown> {
  const node = input.collectionSchema
    ? stripContext(input.collectionSchema)
    : {
        '@type': 'CollectionPage',
        name: `${input.merchantName} online store`,
        description: input.description,
        url: storeUrl(input.baseUrl),
      };

  const hasPart = [
    categoryHubList
      ? { '@id': schemaId(input.baseUrl, 'category-hubs') }
      : null,
    input.blogEnabled
      ? { '@id': `${storeUrl(input.baseUrl, 'blog')}#blog` }
      : null,
  ].filter(Boolean);

  const mainEntity = node.mainEntity;

  return {
    ...node,
    '@id': schemaId(input.baseUrl, 'homepage'),
    '@type': node['@type'] ?? 'CollectionPage',
    url: storeUrl(input.baseUrl),
    isPartOf: { '@id': schemaId(input.baseUrl, 'website') },
    publisher: { '@id': schemaId(input.baseUrl, 'online-store') },
    about: buildAboutTopics(input),
    ...(isRecord(mainEntity) && {
      mainEntity: {
        ...mainEntity,
        '@id': schemaId(input.baseUrl, 'featured-products'),
        name: `${input.merchantName} featured products`,
      },
    }),
    ...(hasPart.length > 0 && { hasPart }),
    significantLink: [
      storeUrl(input.baseUrl, 'products'),
      ...categories.map((category) => storeUrl(input.baseUrl, category.slug)),
      ...buildProductSignificantLinks(input),
      ...(input.blogEnabled ? [storeUrl(input.baseUrl, 'blog')] : []),
    ],
  };
}

function buildBlogNode(
  input: StorefrontHomeSemanticGraphInput
): Record<string, unknown> | null {
  if (!input.blogEnabled) {
    return null;
  }

  return {
    '@type': 'Blog',
    '@id': `${storeUrl(input.baseUrl, 'blog')}#blog`,
    name: `${input.merchantName} buying guides and technology updates`,
    url: storeUrl(input.baseUrl, 'blog'),
    isPartOf: { '@id': schemaId(input.baseUrl, 'website') },
    publisher: { '@id': schemaId(input.baseUrl, 'online-store') },
    about: buildAboutTopics(input),
  };
}

export function buildStorefrontHomeSemanticGraph(
  input: StorefrontHomeSemanticGraphInput
): JsonLdGraphData {
  const categories = normalizeCategoryLinks(input.categories);
  const categoryHubList = buildCategoryHubList(input, categories);
  const collectionNode = buildCollectionNode(
    input,
    categories,
    categoryHubList
  );
  const blogNode = buildBlogNode(input);

  return {
    '@context': 'https://schema.org',
    '@graph': [
      ...withIdentityIds(
        getIdentityGraphNodes(input.identityGraph),
        input.baseUrl
      ),
      collectionNode,
      categoryHubList,
      buildNavigationNode(input, categories),
      blogNode,
    ].filter(isJsonLdGraphNode),
  };
}
