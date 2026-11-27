export function buildFramedAnchorInterceptorSnippet(): string {
  return `
function serializeGetFormParams(form) {
  const params = new URLSearchParams();
  if (!form) return params;
  if (typeof FormData === 'function' && typeof HTMLFormElement === 'function' && form instanceof HTMLFormElement) {
    for (const [k, v] of new FormData(form).entries()) {
      if (typeof v === 'string') params.append(k, v);
    }
    return params;
  }
  const els = form.elements ? Array.from(form.elements) : [];
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    if (!el || el.disabled || typeof el.name !== 'string' || el.name.length === 0) continue;
    const type = typeof el.type === 'string' ? el.type.toLowerCase() : '';
    if ((type === 'checkbox' || type === 'radio') && !el.checked) continue;
    if (type === 'file' || type === 'submit' || type === 'button' || type === 'reset' || type === 'image') continue;
    if (typeof el.value === 'string') params.append(el.name, el.value);
  }
  return params;
}

function attachFramedNavigationInterceptors(container, commerce, initialProps) {
  if (!window.parent || window.parent === window || typeof container.addEventListener !== 'function') {
    return;
  }
  const slug = typeof initialProps?.merchantSlug === 'string' && initialProps.merchantSlug.length > 0 ? initialProps.merchantSlug : 'store';
  const initPath = typeof initialProps?.pathname === 'string' && initialProps.pathname.startsWith('/') ? initialProps.pathname : '/';
  const fallbackBase = \`https://\${slug}.usebaci.com\${initPath}\`;
  const getBaseHref = () =>
    typeof document !== 'undefined' && typeof document.baseURI === 'string' && /^https?:\\/\\//i.test(document.baseURI)
      ? document.baseURI
      : fallbackBase;
  const isPermittedTargetOrigin = (origin, baseOrigin) =>
    origin === baseOrigin || origin === 'https://usebaci.com' || origin === \`https://\${slug}.usebaci.com\`;

  const handleAnchorEvent = (event) => {
    if (!event || event.defaultPrevented) return;
    const isAux = event.type === 'auxclick';
    if (isAux && event.button !== 1) return;
    if (!isAux && typeof event.button === 'number' && event.button !== 0) return;
    let node = event.target;
    while (node && node !== container) {
      const tag = typeof node.tagName === 'string' ? node.tagName.toUpperCase() : '';
      if (tag === 'A' || tag === 'AREA') break;
      node = node.parentElement || node.parentNode;
    }
    const foundTag = node && typeof node.tagName === 'string' ? node.tagName.toUpperCase() : '';
    if (foundTag !== 'A' && foundTag !== 'AREA') return;
    const rawHref = typeof node.getAttribute === 'function' ? node.getAttribute('href') : node.href;
    if (typeof rawHref !== 'string' || rawHref.length === 0 || rawHref.startsWith('#')) return;
    event.preventDefault();
    const targetAttr = typeof node.getAttribute === 'function' ? node.getAttribute('target') : node.target;
    const openNew = isAux || targetAttr === '_blank' || Boolean(event.metaKey || event.ctrlKey || event.shiftKey);
    try {
      const baseHref = getBaseHref();
      const baseOrigin = new URL(baseHref).origin;
      const parsed = new URL(rawHref, baseHref);
      if (!isPermittedTargetOrigin(parsed.origin, baseOrigin)) return;
      if (parsed.pathname === '/checkout' || parsed.pathname.startsWith('/checkout/')) {
        void commerce.checkout.open();
        return;
      }
      const rel = parsed.pathname + parsed.search + parsed.hash;
      void (openNew ? commerce.navigation.open(rel) : commerce.navigation.go(rel));
    } catch {}
  };
  container.addEventListener('click', handleAnchorEvent);
  container.addEventListener('auxclick', handleAnchorEvent);
  container.addEventListener('submit', (event) => {
    if (!event || event.defaultPrevented) return;
    event.preventDefault();
    const form = event.target;
    const rawAction = form && (typeof form.getAttribute === 'function' ? form.getAttribute('action') : form.action);
    const rawMethod = form && (typeof form.getAttribute === 'function' ? form.getAttribute('method') : form.method);
    const formMethod = typeof rawMethod === 'string' && rawMethod.trim().length > 0 ? rawMethod.trim().toLowerCase() : 'get';
    try {
      const baseHref = getBaseHref();
      const baseOrigin = new URL(baseHref).origin;
      const effectiveAction = typeof rawAction === 'string' && rawAction.length > 0 ? rawAction : baseHref;
      const parsed = new URL(effectiveAction, baseHref);
      if (!isPermittedTargetOrigin(parsed.origin, baseOrigin)) return;
      if (parsed.pathname === '/checkout' || parsed.pathname.startsWith('/checkout/')) {
        void commerce.checkout.open();
        return;
      }
      if (formMethod !== 'get') return;
      const qs = serializeGetFormParams(form).toString();
      parsed.search = qs ? \`?\${qs}\` : '';
      void commerce.navigation.go(parsed.pathname + parsed.search + parsed.hash);
    } catch {}
  });
}
`;
}
