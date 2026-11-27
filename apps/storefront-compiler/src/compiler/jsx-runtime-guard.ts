export const JSX_RUNTIME_VIRTUAL_PATH = '__baci_jsx_runtime__.ts';

export function buildSafeJsxRuntimeSource(
  merchantSlug: string,
  declaredAssetIds: readonly string[] = []
): string {
  const trustedOrigin = `https://${merchantSlug}.usebaci.com`;
  return `
import { Fragment, jsx as rawJsx, jsxs as rawJsxs } from 'react/jsx-runtime';

const TRUSTED_ORIGIN = ${JSON.stringify(trustedOrigin)};
const DECLARED_ASSETS = new Set(${JSON.stringify(declaredAssetIds)});
const CSS_RES_TOKEN_RE = /url\\s*\\(|src\\s*\\(|image-set\\s*\\(|\\\\/i;
const SAFE_ASSET_URL_RE = /^url\\(\\s*(?:"(\\/assets\\/[A-Za-z0-9._-]+|#[A-Za-z0-9._-]+)"|'(\\/assets\\/[A-Za-z0-9._-]+|#[A-Za-z0-9._-]+)'|(\\/assets\\/[A-Za-z0-9._-]+|#[A-Za-z0-9._-]+))\\s*\\)$/i;

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
    try {
      const u = new URL(val, 'https://store.example');
      return u.origin === 'https://store.example' && !u.pathname.startsWith('//');
    } catch {
      return false;
    }
  }
  try {
    const u = new URL(val);
    if (u.username || u.password) return false;
    return u.origin === 'https://usebaci.com' || u.origin === TRUSTED_ORIGIN;
  } catch {
    return false;
  }
}

function isSafeInlineStyleValue(val) {
  if (typeof val !== 'string' || !CSS_RES_TOKEN_RE.test(val)) return true;
  const m = SAFE_ASSET_URL_RE.exec(val.trim());
  if (!m) return false;
  const ref = m[1] || m[2] || m[3] || '';
  return ref.startsWith('#') || DECLARED_ASSETS.has(ref.slice('/assets/'.length));
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
  if (
    (typeof type !== 'string' && (typeof type !== 'object' || type === null)) ||
    !props ||
    typeof props !== 'object'
  ) {
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
