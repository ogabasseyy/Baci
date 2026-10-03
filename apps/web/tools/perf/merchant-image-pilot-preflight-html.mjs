// Served-HTML extraction: preload links, pictures, binding sections, and
// URL helpers. Parsing is regex-based and lab-marker-scoped; downstream
// gates compare extracted values, never raw markup.
export function parseAttrs(tag) {
  const attrs = {};
  for (const match of tag.matchAll(/([\w-]+)="([^"]*)"/g)) {
    attrs[match[1].toLowerCase()] = match[2];
  }
  return attrs;
}

export function extractLabPreloads(html) {
  const links = [];
  for (const match of String(html).matchAll(/<link\b([^>]*)>/g)) {
    const attrs = parseAttrs(match[1]);
    if (!('data-pilot-lab-preload' in attrs)) {
      continue;
    }
    links.push({
      arm: attrs['data-pilot-lab-preload'],
      as: attrs.as,
      binding: attrs['data-pilot-lab-binding'],
      fetchPriority: attrs.fetchpriority,
      href: attrs.href,
      imageSizes: attrs.imagesizes,
      imageSrcSet: attrs.imagesrcset,
      media: attrs.media,
      rel: attrs.rel,
      type: attrs.type,
    });
  }
  return links;
}

export function extractLabPictures(html) {
  const pictures = [];
  for (const match of String(html).matchAll(
    /<picture\b([^>]*)>([\s\S]*?)<\/picture>/g
  )) {
    const attrs = parseAttrs(match[1]);
    if (
      !(
        'data-pilot-lab-picture' in attrs ||
        'data-pilot-lab-hero-slide' in attrs ||
        'data-pilot-lab-card-image' in attrs ||
        'data-pilot-lab-header-logo' in attrs
      )
    ) {
      continue;
    }
    const sources = [];
    for (const source of match[2].matchAll(/<source\b([^>]+)>/g)) {
      const sourceAttrs = parseAttrs(source[1]);
      sources.push({
        media: sourceAttrs.media,
        sizes: sourceAttrs.sizes,
        srcSet: sourceAttrs.srcset,
        type: sourceAttrs.type,
      });
    }
    pictures.push({ arm: attrs['data-pilot-lab-picture'] ?? null, sources });
  }
  return pictures;
}

export function extractLabBindings(html) {
  const bindings = [];
  for (const match of String(html).matchAll(
    /data-pilot-lab-binding="([^"]+)"/g
  )) {
    bindings.push(match[1]);
  }
  return bindings;
}

// Binding sections are the unit of served coverage: every intended mount is
// verified inside its own section (kind, identity, and hint pairing), never
// by document order across sections. Reporting rows (not-optimized /
// missing-binding) carry the same markers so they are auditable — and so
// the mount gate can tell "reported" from "mounted".
export function extractLabSections(html) {
  const sections = [];
  for (const match of String(html).matchAll(
    /<section\b([^>]*)>([\s\S]*?)<\/section>/g
  )) {
    const attrs = parseAttrs(match[1]);
    if (
      !(
        'data-pilot-lab-binding' in attrs ||
        attrs['data-pilot-lab-status'] === 'missing-binding'
      )
    ) {
      continue;
    }
    sections.push({
      binding: attrs['data-pilot-lab-binding'] ?? null,
      html: match[2],
      slotId: attrs['data-pilot-lab-slot'] ?? null,
      status: attrs['data-pilot-lab-status'] ?? null,
    });
  }
  return sections;
}

export function sectionPictures(sectionHtml) {
  // Every <picture> in the section — lab-marked mounts and original-renderer
  // control mounts (the store control hero has no lab marker by design).
  const pictures = [];
  for (const match of String(sectionHtml).matchAll(
    /<picture\b([^>]*)>([\s\S]*?)<\/picture>/g
  )) {
    const attrs = parseAttrs(match[1]);
    const sources = [];
    for (const source of match[2].matchAll(/<source\b([^>]+)>/g)) {
      const sourceAttrs = parseAttrs(source[1]);
      sources.push({
        media: sourceAttrs.media,
        sizes: sourceAttrs.sizes,
        srcSet: sourceAttrs.srcset,
        type: sourceAttrs.type,
      });
    }
    const img = match[2].match(/<img\b([^>]+)>/);
    pictures.push({
      attrs,
      img: img ? parseAttrs(img[1]) : null,
      sources,
    });
  }
  return pictures;
}

export function sectionLinks(sectionHtml, arm) {
  const links = [];
  for (const match of String(sectionHtml).matchAll(/<link\b([^>]*)>/g)) {
    const attrs = parseAttrs(match[1]);
    if (attrs['data-pilot-lab-preload'] !== arm) {
      continue;
    }
    links.push({
      as: attrs.as,
      fetchPriority: attrs.fetchpriority,
      href: attrs.href,
      imageSizes: attrs.imagesizes,
      imageSrcSet: attrs.imagesrcset,
      media: attrs.media,
      rel: attrs.rel,
      type: attrs.type,
    });
  }
  return links;
}

export function sectionStandaloneImgs(sectionHtml) {
  const stripped = String(sectionHtml).replace(
    /<picture\b[\s\S]*?<\/picture>/g,
    ''
  );
  return [...stripped.matchAll(/<img\b([^>]+)>/g)].map((match) =>
    parseAttrs(match[1])
  );
}

// Mount-kind classification for one section picture. Gallery mounts carry
// data-pilot-lab-picture (hero iff a source has media); store pilot mounts
// carry their slot marker; the store control hero is the unmarked original
// renderer (media source, no lab marker).
export function pictureKind(picture) {
  const attrs = picture.attrs;
  if ('data-pilot-lab-hero-slide' in attrs) {
    return 'hero-slide';
  }
  if ('data-pilot-lab-card-image' in attrs) {
    return 'card-image';
  }
  if ('data-pilot-lab-header-logo' in attrs) {
    return 'header-logo';
  }
  if ('data-pilot-lab-picture' in attrs) {
    return picture.sources.some((source) => source.media)
      ? 'gallery-hero'
      : 'gallery-picture';
  }
  if (picture.sources.some((source) => source.media)) {
    return 'original-hero';
  }
  return 'original-picture';
}

export function stripQuery(url, origin) {
  return relativizeServedUrl(String(url ?? '').split('?')[0], origin);
}

// Same-origin absolute lab URLs (the store card path serves absolute staged
// URLs because the original card renderer rejects relative ones — see
// lab-store-page.tsx) compare as their path; anything else passes through
// untouched so foreign hosts still fail the lab-prefix gates.
export function relativizeServedUrl(url, origin) {
  const value = String(url ?? '');
  const root = String(origin ?? '').replace(/\/$/, '');
  if (
    root &&
    value.startsWith(root) &&
    value.slice(root.length).startsWith('/')
  ) {
    return value.slice(root.length);
  }
  return value;
}

export function srcSetHasBase(srcSet, base, origin) {
  return srcSetCandidates(srcSet).some(
    (candidate) => stripQuery(candidate.url, origin) === base
  );
}

export function srcSetHasPrefix(srcSet, prefix, origin) {
  return srcSetCandidates(srcSet).some((candidate) =>
    stripQuery(candidate.url, origin).startsWith(prefix)
  );
}

export function srcSetCandidates(srcSet) {
  const value = String(srcSet ?? '').trim();
  if (!value) {
    return [];
  }
  const described = [...value.matchAll(/(\S+) (\d+)w/g)].map((match) => ({
    descriptor: Number(match[2]),
    url: match[1],
  }));
  if (described.length > 0) {
    return described;
  }
  return [{ descriptor: null, url: value }];
}

// Every served lab URL in one section: picture sources, the section
// preload link, and standalone original-renderer imgs (store control arm).
export function sectionLabUrls(sectionHtml, arm) {
  const urls = [];
  for (const picture of sectionPictures(sectionHtml)) {
    for (const source of picture.sources) {
      for (const candidate of srcSetCandidates(source.srcSet)) {
        urls.push(candidate.url);
      }
    }
    if (picture.img?.src) {
      urls.push(picture.img.src);
    }
  }
  for (const link of sectionLinks(sectionHtml, arm)) {
    if (link.href) {
      urls.push(link.href);
    }
    for (const candidate of srcSetCandidates(link.imageSrcSet)) {
      urls.push(candidate.url);
    }
  }
  for (const img of sectionStandaloneImgs(sectionHtml)) {
    if (img.src) {
      urls.push(img.src);
    }
    for (const candidate of srcSetCandidates(img.srcset)) {
      urls.push(candidate.url);
    }
  }
  return urls;
}
