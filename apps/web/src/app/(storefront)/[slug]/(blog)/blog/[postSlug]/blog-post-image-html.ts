import { escapeHtmlText } from '@/lib/sanitize';
import { sanitizeFigcaptionHtml } from './blog-figcaption-sanitizer';
import {
  escapeHtmlAttr,
  readHtmlTagAttribute,
  setHtmlAttribute,
  stripHtmlAttribute,
} from './blog-html-attribute-utils';
import { sanitizeBlogImageCaptionText } from './blog-image-caption-sanitizer';
import { unescapeHtmlText } from './unescape-html-text';

export { sanitizeBlogImageCaptionText, unescapeHtmlText };

const DEFAULT_BLOG_IMAGE_ALT = 'Blog image';

const STANDALONE_IMAGE_BOUNDARY_TAGS = new Set(
  'article aside blockquote body dd details div dt figure footer h1 h2 h3 h4 h5 h6 header img li main nav ol p section ul'.split(
    ' '
  )
);
const HTML_TAG_AT_END_REGEX = /<\s*\/?\s*([a-z][a-z0-9-]*)\b[^>]*>\s*$/i;
const HTML_TAG_AT_START_REGEX = /^\s*<\s*\/?\s*([a-z][a-z0-9-]*)\b[^>]*>/i;

function deriveAltFromImageSrc(src: string): string {
  const source = src.trim();
  if (!source) {
    return '';
  }

  let parsedPath = source;
  try {
    parsedPath = decodeURIComponent(new URL(source).pathname);
  } catch {
    parsedPath = source;
  }

  const fileName = parsedPath
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .pop();
  return fileName
    ? fileName
        .replace(/\.[a-z0-9]{2,8}$/i, '')
        .replace(/[-_](\d{2,5}x\d{2,5})$/i, '')
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
}

export function ensureBlogImageAltText(
  html: string,
  fallbackAltText: string | null | undefined
): string {
  const fallbackText = fallbackAltText?.trim() || DEFAULT_BLOG_IMAGE_ALT;
  const fallback = fallbackText.slice(0, 200);

  return html.replace(/<img\b[^>]*>/gi, (imgTag) => {
    const srcMatch = imgTag.match(/\bsrc\s*=\s*(['"])(.*?)\1/i);
    const derivedAlt = deriveAltFromImageSrc(srcMatch?.[2] ?? '');
    const altCandidate = (derivedAlt || fallback).slice(0, 200).trim();
    const escapedAlt = escapeHtmlAttr(altCandidate);
    const altAttrRegex = /\balt\s*=\s*(['"])(.*?)\1/i;
    const currentAltMatch = imgTag.match(altAttrRegex);
    const currentAlt = currentAltMatch?.[2];

    if (currentAlt !== undefined) {
      return imgTag;
    }

    if (/\/\s*>$/.test(imgTag)) {
      return imgTag.replace(/\/\s*>$/, ` alt="${escapedAlt}" />`);
    }

    return imgTag.replace(/>$/, ` alt="${escapedAlt}">`);
  });
}

function formatFigureAttributes(attributes: string | undefined): string {
  const trimmedAttributes = attributes?.trim();
  return trimmedAttributes ? ` ${trimmedAttributes}` : '';
}

function sanitizeImageTitleAttribute(imgTag: string): string {
  const rawTitle = readHtmlTagAttribute(imgTag, 'title');
  if (rawTitle === null) return imgTag;
  if (!rawTitle.trim()) return imgTag;
  const unescapedTitle = unescapeHtmlText(rawTitle);
  const sanitized = sanitizeBlogImageCaptionText(unescapedTitle);
  if (!sanitized) {
    return stripHtmlAttribute(imgTag, 'title');
  }
  // Only rewrite title if sanitization changed the text, avoiding needless round-trips
  if (sanitized === unescapedTitle) {
    return imgTag;
  }
  return setHtmlAttribute(imgTag, 'title', escapeHtmlAttr(sanitized));
}

function buildFigureFromTitledImage(
  imgTag: string,
  figureAttributes?: string
): string | null {
  const rawTitle = readHtmlTagAttribute(imgTag, 'title');
  if (rawTitle === null) return null;
  const trimmedTitle = rawTitle.trim();
  if (!trimmedTitle) return null;

  const sanitizedCaption = sanitizeBlogImageCaptionText(
    unescapeHtmlText(trimmedTitle)
  );
  const imageWithoutTitle = stripHtmlAttribute(imgTag, 'title');

  if (!sanitizedCaption) {
    return figureAttributes !== undefined
      ? `<figure${formatFigureAttributes(figureAttributes)}>${imageWithoutTitle}</figure>`
      : imageWithoutTitle;
  }

  const captionText = escapeHtmlText(sanitizedCaption);

  return `<figure${formatFigureAttributes(figureAttributes)}>${imageWithoutTitle}<figcaption>${captionText}</figcaption></figure>`;
}

function isStandaloneImageBoundaryTag(tagName: string | undefined): boolean {
  return !!tagName && STANDALONE_IMAGE_BOUNDARY_TAGS.has(tagName.toLowerCase());
}

function hasStandaloneImageBoundaryBefore(
  html: string,
  index: number
): boolean {
  const before = html.slice(0, index).trimEnd();
  if (!before) {
    return true;
  }

  return isStandaloneImageBoundaryTag(before.match(HTML_TAG_AT_END_REGEX)?.[1]);
}

function hasStandaloneImageBoundaryAfter(html: string, index: number): boolean {
  const after = html.slice(index).trimStart();
  if (!after) {
    return true;
  }

  return isStandaloneImageBoundaryTag(
    after.match(HTML_TAG_AT_START_REGEX)?.[1]
  );
}

function isStandaloneImageBlock(
  html: string,
  imageStart: number,
  imageLength: number
): boolean {
  return (
    hasStandaloneImageBoundaryBefore(html, imageStart) &&
    hasStandaloneImageBoundaryAfter(html, imageStart + imageLength)
  );
}

export function transformImageTitlesToFigureCaptions(html: string): string {
  // 1. Sanitize any existing <figcaption> content
  const withSanitizedCaptions = html.replace(
    /<figcaption\b([^>]*)>([\s\S]*?)<\/figcaption>/gi,
    (_match, attrs, content) => {
      const sanitizedHtml = sanitizeFigcaptionHtml(content);
      if (!sanitizedHtml) {
        return '';
      }
      return `<figcaption${attrs}>${sanitizedHtml}</figcaption>`;
    }
  );

  // 2. Strip title attributes from images inside figures that have a figcaption
  const withCleanExistingFigures = withSanitizedCaptions.replace(
    /<figure\b([^>]*)>([\s\S]*?)<\/figure>/gi,
    (figure, attrs, content) => {
      if (/<figcaption\b/i.test(content)) {
        const cleanedContent = content.replace(
          /<img\b[^<>]*>/gi,
          (imgTag: string) => stripHtmlAttribute(imgTag, 'title')
        );
        return `<figure${attrs}>${cleanedContent}</figure>`;
      }
      return figure;
    }
  );

  // 3. Convert standalone titled images in <figure> to figures with <figcaption>
  const withStandaloneFigures = withCleanExistingFigures.replace(
    /<figure\b([^>]*)>\s*(<img\b[^<>]*>)\s*<\/figure>/gi,
    (figure, figureAttributes, imgTag) => {
      return buildFigureFromTitledImage(imgTag, figureAttributes) ?? figure;
    }
  );

  // 4. Convert standalone titled images in <p> to <figure>
  const withStandaloneImageParagraphs = withStandaloneFigures.replace(
    /<p\b([^>]*)>\s*(<img\b[^<>]*>)\s*<\/p>/gi,
    (paragraph, paragraphAttributes, imgTag) => {
      return (
        buildFigureFromTitledImage(imgTag, paragraphAttributes) ?? paragraph
      );
    }
  );

  // 5. Convert standalone <img> to <figure>
  const withFigures = withStandaloneImageParagraphs.replace(
    /(<p\b[^>]*>[\s\S]*?<\/p>)|(<img\b[^<>]*>)/gi,
    (match, paragraph, imgTag, offset, fullHtml) => {
      if (paragraph) {
        return paragraph;
      }

      if (!imgTag) {
        return match;
      }

      if (!isStandaloneImageBlock(fullHtml, offset, imgTag.length)) {
        return match;
      }

      return buildFigureFromTitledImage(imgTag) ?? match;
    }
  );

  // 6. Sanitize remaining inline image titles that were not converted to figures
  return withFigures.replace(/<img\b[^<>]*>/gi, (imgTag: string) =>
    sanitizeImageTitleAttribute(imgTag)
  );
}
