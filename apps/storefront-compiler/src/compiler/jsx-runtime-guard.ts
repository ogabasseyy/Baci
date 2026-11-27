export function buildSafeJsxRuntimeSource(merchantSlug: string): string {
  const trustedOrigin = `https://${merchantSlug}.usebaci.com`;
  return `
import { Fragment, jsx as rawJsx, jsxs as rawJsxs } from 'react/jsx-runtime';

const TRUSTED_ORIGIN = ${JSON.stringify(trustedOrigin)};

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
    if (
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
