import type sanitizeLib from 'sanitize-html';
import { createHeadingHierarchyNormalizer } from '@/lib/sanitize-heading-hierarchy';

export type SanitizeHtmlHeadingOptions =
  | {
      headingLevelOffset?: number;
      normalizeHeadingHierarchy?: false | undefined;
    }
  | {
      headingLevelOffset?: never;
      normalizeHeadingHierarchy: true;
    };

export type SanitizeHtmlOptions = SanitizeHtmlHeadingOptions & {
  forceLazyImages?: boolean;
  normalizeSeoAnchors?: boolean;
  stripNofollowFromLinks?: boolean;
  trustedPriorityImageSources?: readonly string[];
};

function clampHeadingLevel(level: number) {
  return Math.min(6, Math.max(1, level));
}

function normalizeTrustedPriorityImageSource(value: string): string {
  return value.replace(/&amp;/gi, '&');
}

function createTrustedPriorityImageSourceSet(
  sources: readonly string[] | undefined
): ReadonlySet<string> {
  return new Set(
    (sources ?? [])
      .map((source) => normalizeTrustedPriorityImageSource(source.trim()))
      .filter(Boolean)
  );
}

function isSyntheticTechnicalResourcePath(pathname: string): boolean {
  return (
    pathname === '/_next/image' ||
    pathname.startsWith('/_next/data/') ||
    pathname.startsWith('/_next/static/')
  );
}

function isTechnicalResourceHref(href: string | undefined): boolean {
  const normalizedHref = href?.trim().toLowerCase();
  if (!normalizedHref) {
    return false;
  }
  try {
    const { pathname } = new URL(normalizedHref, 'https://example.invalid');
    return isSyntheticTechnicalResourcePath(pathname);
  } catch {
    return isSyntheticTechnicalResourcePath(stripQueryAndHash(normalizedHref));
  }
}

function decodeUriComponentSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getDecodedHrefCandidates(value: string): string[] {
  const candidates = [value];
  let current = value;

  for (let index = 0; index < 3; index += 1) {
    const decoded = decodeUriComponentSafely(current);
    if (decoded === current) {
      break;
    }
    candidates.push(decoded);
    current = decoded;
  }

  return candidates;
}

function stripQueryAndHash(value: string): string {
  const queryIndex = value.indexOf('?');
  const hashIndex = value.indexOf('#');
  const endIndexes = [queryIndex, hashIndex].filter((index) => index >= 0);
  const endIndex = endIndexes.length > 0 ? Math.min(...endIndexes) : -1;

  return endIndex >= 0 ? value.slice(0, endIndex) : value;
}

function isSerializedAttributeLeakHref(href: string | undefined): boolean {
  const normalizedHref = href?.trim().toLowerCase();
  if (!normalizedHref) {
    return false;
  }

  return getDecodedHrefCandidates(normalizedHref)
    .map(stripQueryAndHash)
    .some(
      (candidate) =>
        candidate.includes('","target"') ||
        candidate.includes('","rel"') ||
        candidate.includes('","href"')
    );
}

function sanitizeAnchorTag(
  _tagName: string,
  attribs: sanitizeLib.Attributes,
  options: Pick<SanitizeHtmlOptions, 'stripNofollowFromLinks'>
) {
  const relTokens = new Set(
    typeof attribs.rel === 'string'
      ? attribs.rel.split(/\s+/).filter(Boolean)
      : []
  );

  if (options.stripNofollowFromLinks) {
    for (const token of Array.from(relTokens)) {
      if (token.toLowerCase() === 'nofollow') {
        relTokens.delete(token);
      }
    }
  }

  relTokens.add('noopener');
  relTokens.add('noreferrer');

  const nextAttribs: sanitizeLib.Attributes = {
    ...attribs,
    rel: Array.from(relTokens).join(' '),
  };

  if (isSerializedAttributeLeakHref(nextAttribs.href)) {
    delete nextAttribs.href;
    delete nextAttribs.target;
  }

  return {
    tagName: 'a',
    attribs: nextAttribs,
  };
}

export function createSanitizeHtmlOptions(
  options: SanitizeHtmlOptions = {}
): sanitizeLib.IOptions {
  const rawHeadingLevelOffset = Number(options.headingLevelOffset ?? 0);
  const headingLevelOffset = Number.isFinite(rawHeadingLevelOffset)
    ? Math.max(0, Math.trunc(rawHeadingLevelOffset))
    : 0;
  const trustedPriorityImageSources = createTrustedPriorityImageSourceSet(
    options.trustedPriorityImageSources
  );
  const transformTags: NonNullable<sanitizeLib.IOptions['transformTags']> = {
    a: (tagName, attribs) => sanitizeAnchorTag(tagName, attribs, options),
    img: (_tagName, attribs) => {
      const nextAttribs = { ...attribs };
      const normalizedImageSource =
        typeof nextAttribs.src === 'string'
          ? normalizeTrustedPriorityImageSource(nextAttribs.src)
          : '';
      const allowPriorityImage =
        nextAttribs.fetchpriority === 'high' &&
        trustedPriorityImageSources.has(normalizedImageSource);
      delete nextAttribs['data-baci-priority-image'];
      if (!allowPriorityImage) {
        delete nextAttribs.fetchpriority;
      }
      if (options.forceLazyImages && !allowPriorityImage) {
        nextAttribs.loading = 'lazy';
        nextAttribs.decoding = 'async';
      }

      return {
        tagName: 'img',
        attribs: nextAttribs,
      };
    },
  };
  const exclusiveFilter: sanitizeLib.IOptions['exclusiveFilter'] =
    options.normalizeSeoAnchors
      ? (frame) => {
          if (frame.tag !== 'a') {
            return false;
          }
          if (!frame.text.trim()) {
            return frame.mediaChildren.length > 0 ? 'excludeTag' : true;
          }
          if (isTechnicalResourceHref(frame.attribs.href)) {
            return 'excludeTag';
          }
          return false;
        }
      : undefined;

  if (options.normalizeHeadingHierarchy) {
    const normalizeHeadingLevel = createHeadingHierarchyNormalizer();
    for (let level = 1; level <= 6; level += 1) {
      transformTags[`h${level}`] = (_tagName, attribs) => ({
        tagName: `h${normalizeHeadingLevel(level)}`,
        attribs,
      });
    }
  } else if (headingLevelOffset > 0) {
    for (let level = 1; level <= 6; level += 1) {
      transformTags[`h${level}`] = (_tagName, attribs) => ({
        tagName: `h${clampHeadingLevel(level + headingLevelOffset)}`,
        attribs,
      });
    }
  }

  return {
    allowedTags: [
      'b',
      'i',
      'em',
      'strong',
      'u',
      's',
      'mark',
      'small',
      'sub',
      'sup',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'br',
      'hr',
      'div',
      'span',
      'blockquote',
      'figure',
      'figcaption',
      'pre',
      'code',
      'ul',
      'ol',
      'li',
      'a',
      'img',
      'picture',
      'source',
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'th',
      'td',
    ],
    allowedAttributes: {
      '*': ['class', 'id', 'title', 'width', 'height', 'colspan', 'rowspan'],
      a: ['href', 'target', 'rel'],
      img: [
        'src',
        'srcset',
        'sizes',
        'alt',
        'width',
        'height',
        'loading',
        'decoding',
        'fetchpriority',
      ],
      source: ['srcset', 'type', 'media', 'sizes'],
      // Tiptap's OrderedList round-trips non-default start and type
      // values, so stripping them would silently renumber or
      // re-letter imported lists.
      ol: ['start', 'type'],
    },
    transformTags,
    exclusiveFilter,
    allowedSchemes: [
      'http',
      'https',
      'mailto',
      'tel',
      'callto',
      'sms',
      'cid',
      'xmpp',
    ],
    allowedSchemesByTag: {
      img: ['http', 'https', 'data'],
    },
    allowProtocolRelative: false,
  };
}
