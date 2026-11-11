import { SENSITIVE_URL_PARAM_NAMES } from './sensitive-url-params';

/**
 * Self-contained browser-side twin of `sanitizeTrackingUrl`, for inline
 * `<script>` bodies (e.g. the GA4 config call) that cannot import modules.
 * It declares `baciSanitizeUrl(url)`. Keep it behaviourally identical to
 * `sanitizeTrackingUrl`; sanitize-tracking-url-inline.test.ts checks that.
 */
export const TRACKING_URL_INLINE_SANITIZER = `
function baciSanitizeUrl(u) {
  if (!u) return u;
  var sensitive = ${JSON.stringify(
    SENSITIVE_URL_PARAM_NAMES.map((name) => name.toLowerCase())
  )};
  var s = String(u).split('#')[0];
  var i = s.indexOf('?');
  if (i < 0) return s;
  var base = s.slice(0, i);
  try {
    var kept = new URLSearchParams();
    new URLSearchParams(s.slice(i + 1)).forEach(function (v, k) {
      if (sensitive.indexOf(k.toLowerCase()) < 0) kept.append(k, v);
    });
    var q = kept.toString();
    return q ? base + '?' + q : base;
  } catch (e) {
    return base;
  }
}
`;
