import { escapeHtmlAttribute } from '@/lib/sanitize';
import { normalizeZohoBrandColor } from './merchant-zoho-campaign-settings';

export type ZohoBlogEmailBrand = {
  brandColor?: string | null;
  brandName?: string | null;
};

export type ZohoBlogEmailPost = {
  category?: string | null;
  content?: string | null;
  excerpt?: string | null;
  featured_image_alt?: string | null;
  featured_image_url?: string | null;
  published_at?: string | null;
  title: string | null;
};

const HTML_TEXT_TAG_NAMES = [
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'dd',
  'del',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  's',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
] as const;
const HTML_TEXT_TAG_PATTERN = new RegExp(
  `</?(?:${HTML_TEXT_TAG_NAMES.join('|')})(?:\\s[^<>]*)?/?>`,
  'gi'
);
const RAW_TEXT_HTML_BLOCK_PATTERN =
  /<(script|style|xmp|iframe|noembed|noframes|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const HTML_COMMENT_PATTERN = /\x3c!--[\s\S]*?-->/g;

function stripKnownHtmlTags(value: string): string {
  return value
    .replace(RAW_TEXT_HTML_BLOCK_PATTERN, '')
    .replace(HTML_COMMENT_PATTERN, '')
    .replace(HTML_TEXT_TAG_PATTERN, '');
}

function normalizeText(
  value: string | null | undefined,
  fallback = ''
): string {
  const stripped = stripKnownHtmlTags(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || fallback;
}

function buildPreviewText(post: ZohoBlogEmailPost): string {
  const excerpt = normalizeText(post.excerpt);
  if (excerpt) return excerpt.slice(0, 240);
  return normalizeText(post.content).slice(0, 240);
}

function normalizeHttpUrl(
  value: string | null | undefined,
  fallback = ''
): string {
  if (!value) return fallback;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return fallback;
    }
    return parsed.toString();
  } catch {
    return fallback;
  }
}

export function buildZohoBlogEmailHtml({
  blogUrl,
  brand,
  post,
}: {
  blogUrl: string;
  brand?: ZohoBlogEmailBrand;
  post: ZohoBlogEmailPost;
}): string {
  const brandName = normalizeText(brand?.brandName, 'Store Updates');
  const title = normalizeText(post.title, `New ${brandName} article`);
  const preview = buildPreviewText(post);
  const safeTitle = escapeHtmlAttribute(title);
  const safePreview = escapeHtmlAttribute(preview);
  const safeBlogUrl = escapeHtmlAttribute(
    normalizeHttpUrl(blogUrl, 'https://usebaci.com/blog')
  );
  const safeBrandName = escapeHtmlAttribute(brandName);
  const safeBrandColor = escapeHtmlAttribute(
    normalizeZohoBrandColor(brand?.brandColor) ?? '#111827'
  );
  const safeCategory = escapeHtmlAttribute(
    normalizeText(post.category, 'Tech')
  );
  const imageUrl = normalizeHttpUrl(post.featured_image_url);
  const safeImageUrl = imageUrl ? escapeHtmlAttribute(imageUrl) : '';
  const safeImageAlt = escapeHtmlAttribute(
    normalizeText(post.featured_image_alt, title)
  );

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${safeTitle}</title>
  </head>
  <body style="margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${safePreview}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e2e8f0;">
            <tr>
              <td style="padding:22px 24px 12px;font-size:14px;font-weight:700;color:${safeBrandColor};letter-spacing:.02em;">${safeBrandName} ${safeCategory}</td>
            </tr>
            ${safeImageUrl ? `<tr><td><img src="${safeImageUrl}" alt="${safeImageAlt}" width="640" style="display:block;width:100%;max-width:640px;height:auto;border:0;"></td></tr>` : ''}
            <tr>
              <td style="padding:28px 24px 8px;">
                <h1 style="margin:0 0 14px;font-size:28px;line-height:1.2;color:#111827;">${safeTitle}</h1>
                <p style="margin:0;color:#475569;font-size:16px;line-height:1.65;">${safePreview}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <a href="${safeBlogUrl}" style="display:inline-block;background:${safeBrandColor};color:#ffffff;text-decoration:none;font-weight:700;border-radius:999px;padding:13px 22px;">Read the full article</a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 26px;color:#64748b;font-size:13px;line-height:1.6;">
                You are receiving this because you subscribed to ${safeBrandName} updates.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
