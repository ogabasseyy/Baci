import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { STOREFRONT_EDGE_ENTRYPOINT_CLASSIFICATIONS } from './storefront-edge-entrypoint-classifications';
import { STOREFRONT_EDGE_INVENTORY_POLICY } from './storefront-edge-inventory-policy';

const execFileAsync = promisify(execFile);

const ROUTES = [...STOREFRONT_EDGE_ENTRYPOINT_CLASSIFICATIONS.keys()];

export async function createStorefrontEdgeInventoryFixture(repoRoot: string) {
  const fixtureGitConfig = [
    '-c',
    'commit.gpgsign=false',
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'gc.auto=0',
    '-c',
    'maintenance.auto=0',
    '-c',
    'user.name=Inventory Test',
    '-c',
    'user.email=inventory@example.invalid',
  ];
  const routeRoot = join(repoRoot, 'apps/web/src/app/(storefront)/[slug]');
  for (const route of ROUTES) {
    const path = join(routeRoot, route);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(
      path,
      route.endsWith('route.ts')
        ? 'export async function GET() {}\nexport const HEAD = GET;\n'
        : route.endsWith('sitemap.ts')
          ? 'export default async function sitemap() { return []; }\n'
          : route.endsWith('opengraph-image.tsx')
            ? 'export default async function Image() { return null; }\n'
            : 'export default function Page() { return null; }\n'
    );
  }
  const blogPostRoot = join(routeRoot, '(blog)/blog/[postSlug]');
  await mkdir(blogPostRoot, { recursive: true });
  await writeFile(
    join(blogPostRoot, 'layout.tsx'),
    'export default function Layout({ children }) { return children; }\n'
  );
  await writeFile(
    join(blogPostRoot, 'actions.ts'),
    "'use server';\nexport async function incrementViewCount() {}\n"
  );
  await writeFile(
    join(blogPostRoot, 'view-counter.tsx'),
    "'use client';\nexport function ViewCounter() { return null; }\n"
  );
  await writeFile(
    join(blogPostRoot, 'blog-post-body.tsx'),
    'export default function BlogPostBody() { return null; }\n'
  );
  await writeFile(
    join(blogPostRoot, 'BlogPostBody.tsx'),
    'export default function BlogPostBodyAlt() { return null; }\n'
  );
  await writeFile(
    join(blogPostRoot, 'BlogVideoPanel.tsx'),
    'export function BlogVideoPanel() { return null; }\n'
  );
  const siblingRouteRoot = join(
    repoRoot,
    'apps/web/src/app/(storefront)/ogabassey'
  );
  const siblingRouteSources = [
    'emit-ogabassey-image-preload.ts',
    'ogabassey-home-dynamic-content.tsx',
    'ogabassey-home-hero-resource-hints.ts',
    'ogabassey-home-hero-shell-data.ts',
    'ogabassey-home-launch-products.ts',
    'ogabassey-home-page-content.tsx',
    'ogabassey-home-product-adapter.ts',
    'ogabassey-home-style-loader.tsx',
    'ogabassey-image-preload-type.ts',
    'ogabassey-pdp-product-lcp-skeleton.tsx',
    'ogabassey-pdp-product-resource-hints.ts',
    'ogabassey-pdp-static-resource-hints.tsx',
    'ogabassey-publication-safe-hero-fallback.tsx',
    'ogabassey-static-home-page-content.tsx',
    'ogabassey-static-resource-hints.tsx',
    'resource-hint-test-utils.ts',
  ] as const;
  await mkdir(siblingRouteRoot, { recursive: true });
  for (const source of siblingRouteSources) {
    await writeFile(join(siblingRouteRoot, source), `// ${source}\n`);
  }
  for (const input of STOREFRONT_EDGE_INVENTORY_POLICY.routingInputPaths) {
    const path = join(repoRoot, input);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, `// ${input}\n`);
  }
  const apiRoot = join(repoRoot, 'apps/web/src/app/api');
  const apiRoutes = [
    {
      path: 'events/route.ts',
      source: 'export async function POST() {}\n',
    },
    {
      path: 'orders/[id]/route.ts',
      source:
        'export async function GET() {}\nexport async function PATCH() {}\n',
    },
    {
      path: 'orders/route.ts',
      source: 'export async function POST() {}\n',
    },
  ];
  for (const route of apiRoutes) {
    const path = join(apiRoot, route.path);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, route.source);
  }
  await execFileAsync('git', [
    '-C',
    repoRoot,
    ...fixtureGitConfig,
    'init',
    '--quiet',
  ]);
  await execFileAsync('git', ['-C', repoRoot, ...fixtureGitConfig, 'add', '.']);
  await execFileAsync('git', [
    '-C',
    repoRoot,
    ...fixtureGitConfig,
    'commit',
    '--quiet',
    '-m',
    'fixture',
  ]);
  const { stdout } = await execFileAsync('git', [
    '-C',
    repoRoot,
    'rev-parse',
    'HEAD',
  ]);
  return stdout.trim();
}
