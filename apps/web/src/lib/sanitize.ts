// Input Sanitization Utilities
// For server components that don't need HTML sanitization, import from './sanitize-core' instead

import sanitizeLib from 'sanitize-html';
import {
  createSanitizeHtmlOptions,
  type SanitizeHtmlOptions,
} from '@/lib/sanitize-html-config';
import { stripDisallowedRawTextBlocks } from '@/lib/sanitize-raw-text-blocks';
import {
  normalizeXml10ForHtmlParsing,
  stripInvalidXml10Characters,
} from '@/lib/sanitize-xml-10';

// Re-export removed as per knip analysis
// import from './sanitize-core' directly if needed

const ESCAPE_HTML_TEXT_OPTIONS: sanitizeLib.IOptions = {
  allowedTags: [],
  allowedAttributes: {},
  disallowedTagsMode: 'escape',
  parser: {
    lowerCaseAttributeNames: false,
    lowerCaseTags: false,
  },
};

const HTML_ATTRIBUTE_ESCAPE_REGEX = /[&<>"']/g;
const HTML_ATTRIBUTE_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Sanitize HTML content to prevent XSS attacks using sanitize-html.
 *
 * **Security Note**: This function is safe to use with `dangerouslySetInnerHTML`
 * as it whitelists only safe HTML tags and attributes. All user-generated content
 * and AI-generated content MUST pass through this function before rendering.
 *
 * **Why this is secure**:
 * - Uses industry-standard sanitize-html library (server-side friendly)
 * - Whitelist-based approach (only allowed tags/attributes pass through)
 * - Prevents `<script>`, `<iframe>`, `<object>`, `onclick`, etc.
 * - Validates URLs to prevent `javascript:` and `data:` URIs
 * - No dependency on jsdom (prevents ESM crashes in Vercel/Next.js)
 *
 * **Allowed content**:
 * - Text formatting (bold, italic, underline, etc.)
 * - Structural elements (headings, paragraphs, divs, spans)
 * - Lists (ordered and unordered)
 * - Links and images (with URL validation)
 * - Tables (for rich blog content)
 * - Code blocks (for technical content)
 *
 * **Security scanner notes**: GitHub CodeQL may flag `dangerouslySetInnerHTML`
 * even when using this function. These are false positives. The content is
 * sanitized and safe to render.
 *
 * @example
 * ```tsx
 * // Use the SafeHtml component instead of dangerouslySetInnerHTML directly
 * import { SafeHtml } from '@/components/ui/safe-html';
 * <SafeHtml html={userContent} className="prose" />
 * ```
 *
 * @param dirty - Untrusted HTML string from user input or AI generation
 * @returns Sanitized HTML safe for rendering in React components
 *
 * @see https://github.com/apostrophecms/sanitize-html for documentation
 */
export function sanitizeHtml(
  dirty: string,
  options: SanitizeHtmlOptions = {}
): string {
  const dirtyWithoutRawTextBlocks = stripDisallowedRawTextBlocks(dirty);

  return sanitizeLib(
    dirtyWithoutRawTextBlocks,
    createSanitizeHtmlOptions(options)
  );
}

/**
 * Escapes plain text for HTML text-node interpolation without preserving markup.
 *
 * Use this only for plain text inserted inside element bodies in HTML emails or
 * templates. Quotes are intentionally preserved, so this helper is not safe for
 * HTML attribute interpolation; use an attribute-specific escaper or a proper
 * templating/serialization layer when writing attribute values instead.
 */
export function escapeHtmlText(value: string): string {
  if (!value) return '';
  return sanitizeLib(value, ESCAPE_HTML_TEXT_OPTIONS);
}

/**
 * Escapes plain text for safe HTML attribute interpolation.
 *
 * Use this for values inserted inside quoted attributes such as href, src,
 * title, alt, and aria-* values. Unlike escapeHtmlText, this also escapes
 * quotes so the attribute boundary cannot be broken.
 */
export function escapeHtmlAttribute(value: string): string {
  if (!value) return '';
  return value.replace(
    HTML_ATTRIBUTE_ESCAPE_REGEX,
    (match) => HTML_ATTRIBUTE_ESCAPE_MAP[match]
  );
}

/**
 * Sanitize HTML for RSS/Atom feeds.
 *
 * More restrictive than the general sanitizer — strips structural elements
 * (div, span, table) that RSS readers handle poorly and removes classes/IDs.
 * Ensures all links have rel="noopener noreferrer".
 */
export function sanitizeForFeed(dirty: string): string {
  // Strip BEFORE parsing: sanitize-html's scheme check only deletes U+0000–U+0020,
  // so a forbidden char inside a scheme (java<U+FFFE>script:, raw or &#xFFFE;-
  // encoded) would look schemeless to the parser and then join into javascript:
  // under the outer strip. The outer strip stays to catch anything the
  // sanitizer re-emits.
  const preNormalized = normalizeXml10ForHtmlParsing(dirty);
  return stripInvalidXml10Characters(
    sanitizeLib(preNormalized, {
      allowedTags: [
        'p',
        'br',
        'strong',
        'em',
        'u',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'ul',
        'ol',
        'li',
        'blockquote',
        'pre',
        'code',
        'a',
        'img',
      ],
      allowedAttributes: {
        a: ['href', 'title', 'rel'],
        img: ['src', 'alt', 'title', 'width', 'height'],
      },
      allowedSchemes: ['http', 'https', 'mailto'],
      allowProtocolRelative: false,
      transformTags: {
        a: (tagName, attribs) => ({
          tagName,
          attribs: { ...attribs, rel: 'noopener noreferrer' },
        }),
      },
    })
  );
}

/**
 * Sanitize untrusted SVG content before persisting or rendering it.
 *
 * This allowlist keeps common favicon/vector tags while stripping scripting,
 * foreign content, and unknown attributes.
 */
export function sanitizeSvg(svgContent: string): string {
  return sanitizeLib(svgContent, {
    allowedTags: [
      'svg',
      'path',
      'circle',
      'rect',
      'polygon',
      'line',
      'polyline',
      'ellipse',
      'g',
      'defs',
      'use',
      'symbol',
      'linearGradient',
      'radialGradient',
      'stop',
      'title',
      'desc',
    ],
    allowedAttributes: {
      '*': [
        'id',
        'class',
        'viewBox',
        'xmlns',
        'xmlns:xlink',
        'role',
        'aria-hidden',
        'focusable',
        'fill',
        'stroke',
        'stroke-width',
        'stroke-linecap',
        'stroke-linejoin',
        'stroke-dasharray',
        'stroke-dashoffset',
        'opacity',
        'fill-opacity',
        'stroke-opacity',
        'transform',
      ],
      svg: ['width', 'height', 'x', 'y'],
      path: ['d', 'pathLength'],
      circle: ['cx', 'cy', 'r'],
      rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
      ellipse: ['cx', 'cy', 'rx', 'ry'],
      line: ['x1', 'y1', 'x2', 'y2'],
      polyline: ['points'],
      polygon: ['points'],
      use: ['href', 'xlink:href', 'x', 'y', 'width', 'height'],
      linearGradient: ['id', 'x1', 'y1', 'x2', 'y2', 'gradientUnits'],
      radialGradient: ['id', 'cx', 'cy', 'r', 'fx', 'fy', 'gradientUnits'],
      stop: ['offset', 'stop-color', 'stop-opacity'],
    },
    disallowedTagsMode: 'discard',
    allowedSchemes: ['http', 'https'],
    allowedSchemesAppliedToAttributes: ['href', 'xlink:href'],
    allowProtocolRelative: false,
    parser: {
      lowerCaseTags: false,
      lowerCaseAttributeNames: false,
    },
  });
}
