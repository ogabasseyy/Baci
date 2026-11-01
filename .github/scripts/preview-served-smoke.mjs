function hasHeroImage(html) {
  const visible = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const stack = [];
  const voidTags = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
  ]);
  for (const [tag] of visible.matchAll(/<\/?[a-z][^>]*>/gi)) {
    const name = /^<\/?([a-z][\w-]*)/i.exec(tag)?.[1]?.toLowerCase();
    if (!name) continue;
    if (tag.startsWith('</')) {
      const index = stack.map((item) => item.name).lastIndexOf(name);
      if (index !== -1) stack.length = index;
      continue;
    }
    if (
      name === 'img' &&
      /\bsrc\s*=\s*["'][^"']+["']/i.test(tag) &&
      stack.some((item) => item.hero)
    )
      return true;
    if (!voidTags.has(name) && !tag.endsWith('/>'))
      stack.push({
        name,
        hero: /\sdata-ogabassey-(?:hero|mobile-hero)(?:\s|=|>)/i.test(tag),
      });
  }
  return false;
}

export async function verifyServedPreview({ origin, route, request }) {
  const base = new URL(origin);
  if (
    base.protocol !== 'https:' ||
    !/^baci-[a-z0-9-]+-basseys-projects-d7395611\.vercel\.app$/i.test(
      base.hostname
    ) ||
    base.port ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  ) {
    throw new Error('Invalid preview origin');
  }
  if (!/^\/[a-z0-9-]+(?:\.[a-z0-9-]+)*(?:\/[a-z0-9-]+)*$/i.test(route))
    throw new Error('Invalid preview route');
  const page = await request(new URL(route, base).href);
  if (page.status !== 200)
    throw new Error(`Preview page status ${page.status}`);
  if (
    !/^text\/html(?:;|$)/i.test(page.contentType ?? '') ||
    typeof page.body !== 'string'
  )
    throw new Error('Preview page is not HTML');
  if (!hasHeroImage(page.body))
    throw new Error('Preview hero payload is missing');
  const fonts = [...page.body.matchAll(/<link\b[^>]*>/gi)].flatMap(([tag]) => {
    const attributes = new Map(
      [...tag.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(
        ([, key, value]) => [key.toLowerCase(), value]
      )
    );
    return attributes.get('as')?.toLowerCase() === 'font' &&
      attributes.get('rel')?.toLowerCase() === 'preload'
      ? [attributes.get('href')]
      : [];
  });
  if (
    fonts.some(
      (font) =>
        !font ||
        !/^\/_next\/static\/media\/[a-z0-9._-]+\.woff2(?:\?[^#]*)?$/i.test(font)
    )
  )
    throw new Error('Preview font preload is missing or invalid');
  for (const font of new Set([
    ...fonts,
    '/fonts/inter-naira.61440e0f45d4.woff2',
  ])) {
    const response = await request(new URL(font, base).href);
    if (
      response.status !== 200 ||
      !/^(?:font\/woff2|application\/font-woff2)(?:;|$)/i.test(
        response.contentType ?? ''
      ) ||
      !response.body?.length
    )
      throw new Error('Preview font response is invalid');
  }
}
