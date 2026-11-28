export const JSX_RUNTIME_VIRTUAL_PATH = '__baci_jsx_runtime__.ts';

export function buildSafeJsxRuntimeSource(
  merchantSlug: string,
  declaredAssetIds: readonly string[] = [],
  hostOrigin?: string
): string {
  const trustedOrigin = `https://${merchantSlug}.usebaci.com`;
  const customHostOrigin = hostOrigin ?? '';
  return `
import { Fragment, jsx as rawJsx, jsxs as rawJsxs } from 'react/jsx-runtime';

const TRUSTED_ORIGIN = ${JSON.stringify(trustedOrigin)};
const CUSTOM_HOST_ORIGIN = ${JSON.stringify(customHostOrigin)};
const DECLARED_ASSETS = new Set(${JSON.stringify(declaredAssetIds)});
const CSS_URL_RE = /url\\(\\s*(?:"((?:[^"\\\\]|\\\\[\\s\\S])*)"|'((?:[^'\\\\]|\\\\[\\s\\S])*)'|([^'")\\s]+))\\s*\\)/gi;
const CSS_SRC_FN_RE = /\\bsrc\\(\\s*(?:"((?:[^"\\\\]|\\\\[\\s\\S])*)"|'((?:[^'\\\\]|\\\\[\\s\\S])*)'|([^'")\\s]+))\\s*\\)/gi;
const IMAGE_SET_START_RE = /(?:-[a-z]+-)?image-set\\s*\\(/gi;
const IMAGE_SET_TOKEN_RE = /\\b(?:url|type)\\s*\\(\\s*(?:"(?:[^"\\\\]|\\\\[\\s\\S])*"|'(?:[^'\\\\]|\\\\[\\s\\S])*'|[^'")\\s]*)\\s*\\)|"((?:[^"\\\\]|\\\\[\\s\\S])*)"|'((?:[^'\\\\]|\\\\[\\s\\S])*)'/gi;
const ANY_RES_CALL_RE = /\\b(?:url|src|(?:-[a-z]+-)?image-set)\\s*\\(/i;

function isNavPropKey(key) {
  const lower = key.toLowerCase();
  return (
    lower === 'href' ||
    lower === 'action' ||
    lower === 'formaction' ||
    lower === 'xlinkhref' ||
    lower === 'xlink:href'
  );
}

function isSafeCompletedNavTarget(val) {
  if (typeof val !== 'string' || val.length === 0) return false;
  for (let i = 0; i < val.length; i++) {
    const c = val.charCodeAt(i);
    if (c === 0x5c || c <= 0x1f || c === 0x7f) return false;
  }
  if (val.startsWith('#')) return true;
  if (val.startsWith('/') && !val.startsWith('//')) {
    if (
      val.includes('//') ||
      val.includes('%') ||
      val.split('/').some((seg) => seg === '.' || seg === '..')
    ) {
      return false;
    }
    try {
      const u = new URL(val, 'https://store.example');
      return u.origin === 'https://store.example' && u.pathname === val && u.search === '' && u.hash === '';
    } catch {
      return false;
    }
  }
  try {
    const u = new URL(val);
    if (
      u.username ||
      u.password ||
      u.search !== '' ||
      u.hash !== '' ||
      u.pathname.includes('//') ||
      u.pathname.includes('%')
    ) {
      return false;
    }
    return (
      u.origin === 'https://usebaci.com' ||
      u.origin === TRUSTED_ORIGIN ||
      (CUSTOM_HOST_ORIGIN.length > 0 && u.origin === CUSTOM_HOST_ORIGIN)
    );
  } catch {
    return false;
  }
}

function stripInlineComments(s) {
  return s.replace(
    /(\\\\([\\s\\S])|"(?:[^"\\\\]|\\\\[\\s\\S])*"|'(?:[^'\\\\]|\\\\[\\s\\S])*')|\\/\\*[\\s\\S]*?(?:\\*\\/|$)/g,
    (_m, kept) => (kept !== undefined ? kept : '/**/')
  );
}

function decodeInlineEscapes(s) {
  return s.replace(/\\\\([0-9a-fA-F]{1,6})\\s?|\\\\(.)/g, (_m, hex, ch) => {
    if (hex !== undefined) {
      const cp = Number.parseInt(hex, 16);
      if (Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff) return String.fromCodePoint(cp);
    }
    return ch ?? '';
  });
}

function hasBalancedCssTokens(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\\\') { i += 1; continue; }
    if (ch === '"' || ch === "'") {
      const q = ch;
      i += 1;
      while (i < s.length && s[i] !== q) i += s[i] === '\\\\' ? 2 : 1;
      if (i >= s.length) return false;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

function isAllowedCssAssetRef(raw) {
  const t = String(raw || '').trim();
  if (t.startsWith('#')) return t.length > 1;
  if (!t.startsWith('/assets/')) return false;
  return DECLARED_ASSETS.has(t.slice('/assets/'.length));
}

function checkCandidateStyleCss(cssText) {
  if (!ANY_RES_CALL_RE.test(cssText)) return true;
  if (!hasBalancedCssTokens(cssText)) return false;
  let count = 0;
  for (const m of cssText.matchAll(CSS_URL_RE)) {
    count++;
    if (!isAllowedCssAssetRef(m[1] ?? m[2] ?? m[3] ?? '')) return false;
  }
  for (const m of cssText.matchAll(CSS_SRC_FN_RE)) {
    count++;
    if (!isAllowedCssAssetRef(m[1] ?? m[2] ?? m[3] ?? '')) return false;
  }
  for (const startMatch of cssText.matchAll(IMAGE_SET_START_RE)) {
    let idx = (startMatch.index ?? 0) + startMatch[0].length;
    let depth = 1;
    const bodyStart = idx;
    while (idx < cssText.length && depth > 0) {
      const ch = cssText[idx];
      if (ch === '\\\\') { idx += 2; continue; }
      if (ch === '"' || ch === "'") {
        const q = ch;
        idx += 1;
        while (idx < cssText.length && cssText[idx] !== q) idx += cssText[idx] === '\\\\' ? 2 : 1;
        idx += 1;
        continue;
      }
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      idx += 1;
    }
    if (depth !== 0) return false;
    const rawBody = cssText.slice(bodyStart, Math.max(bodyStart, idx - 1));
    for (const tok of rawBody.matchAll(IMAGE_SET_TOKEN_RE)) {
      const strUrl = tok[1] ?? tok[2];
      if (strUrl !== undefined) {
        count++;
        if (!isAllowedCssAssetRef(strUrl)) return false;
      }
    }
  }
  return count > 0;
}

function isSafeInlineStyleValue(val) {
  if (typeof val !== 'string') return true;
  const noComments = stripInlineComments(val);
  const decoded = decodeInlineEscapes(noComments);
  return checkCandidateStyleCss(noComments) && checkCandidateStyleCss(decoded);
}

function sanitizeInlineStyle(styleObj) {
  if (!styleObj || typeof styleObj !== 'object' || Array.isArray(styleObj)) return styleObj;
  let cloned = null;
  const keys = Object.keys(styleObj);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (!isSafeInlineStyleValue(styleObj[k])) {
      if (!cloned) cloned = { ...styleObj };
      delete cloned[k];
    }
  }
  return cloned || styleObj;
}

function sanitizeJsxNavProps(type, props) {
  if (!type || !props || typeof props !== 'object') {
    return props;
  }
  let cloned = null;
  const keys = Object.keys(props);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (k === 'style') {
      const nextStyle = sanitizeInlineStyle(props.style);
      if (nextStyle !== props.style) {
        if (!cloned) cloned = { ...props };
        cloned.style = nextStyle;
      }
    } else if (
      isNavPropKey(k) &&
      props[k] !== undefined &&
      props[k] !== null &&
      !isSafeCompletedNavTarget(props[k])
    ) {
      if (!cloned) cloned = { ...props };
      cloned[k] = '#';
    }
  }
  return cloned || props;
}

export { Fragment };
export function jsx(type, props, key) {
  return rawJsx(type, sanitizeJsxNavProps(type, props), key);
}
export function jsxs(type, props, key) {
  return rawJsxs(type, sanitizeJsxNavProps(type, props), key);
}
export const jsxDEV = jsx;
`;
}
