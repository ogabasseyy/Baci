export function buildFramedAnchorInterceptorSnippet(): string {
  return `
function readDomStringAttr(el, attrName, propName) {
  if (!el) return null;
  if (typeof el.hasAttribute === 'function' && typeof el.getAttribute === 'function') {
    return el.hasAttribute(attrName) ? el.getAttribute(attrName) : null;
  }
  if (typeof el.getAttribute === 'function') {
    const v = el.getAttribute(attrName);
    if (v !== null && v !== undefined) return v;
  }
  const p = el[propName];
  return typeof p === 'string' ? p : null;
}

function attachFramedNavigationInterceptors(container, commerce, initialProps, getPathname) {
  if (!window.parent || window.parent === window || typeof container.addEventListener !== 'function') {
    return;
  }
  const slug = typeof initialProps?.merchantSlug === 'string' && initialProps.merchantSlug.length > 0 ? initialProps.merchantSlug : 'store';
  const getBaseHref = () => {
    if (typeof document !== 'undefined' && typeof document.baseURI === 'string' && /^https?:\\/\\//i.test(document.baseURI)) {
      return document.baseURI;
    }
    const livePath = typeof getPathname === 'function' ? getPathname() : initialProps?.pathname;
    const safePath = typeof livePath === 'string' && livePath.startsWith('/') ? livePath : '/';
    return \`https://\${slug}.usebaci.com\${safePath}\`;
  };
  const isPermittedTargetOrigin = (origin, baseOrigin) =>
    origin === baseOrigin ||
    origin === 'https://usebaci.com' ||
    origin === \`https://\${slug}.usebaci.com\` ||
    (typeof TRUSTED_HOST_ORIGIN === 'string' && TRUSTED_HOST_ORIGIN.length > 0 && origin === TRUSTED_HOST_ORIGIN);

  container.addEventListener('click', (event) => {
    if (!event || event.defaultPrevented || event.type !== 'click') return;
    if (typeof event.button === 'number' && event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    let node = event.target;
    while (node && node !== container) {
      const tag = typeof node.tagName === 'string' ? node.tagName.toUpperCase() : '';
      if (tag === 'A' || tag === 'AREA') break;
      node = node.parentElement || node.parentNode;
    }
    const foundTag = node && typeof node.tagName === 'string' ? node.tagName.toUpperCase() : '';
    if (foundTag !== 'A' && foundTag !== 'AREA') return;
    const targetAttr = readDomStringAttr(node, 'target', 'target');
    if (typeof targetAttr === 'string' && targetAttr.trim().length > 0 && targetAttr.trim().toLowerCase() !== '_self') {
      return;
    }
    const rawHref = readDomStringAttr(node, 'href', 'href');
    if (typeof rawHref !== 'string' || rawHref.length === 0 || rawHref.startsWith('#')) return;
    event.preventDefault();
    try {
      const baseHref = getBaseHref();
      const baseOrigin = new URL(baseHref).origin;
      const parsed = new URL(rawHref, baseHref);
      if (!isPermittedTargetOrigin(parsed.origin, baseOrigin)) return;
      if (parsed.pathname === '/checkout' || parsed.pathname.startsWith('/checkout/')) {
        void commerce.checkout.open();
        return;
      }
      void commerce.navigation.go(parsed.pathname + parsed.search + parsed.hash);
    } catch {}
  });

  container.addEventListener('submit', (event) => {
    if (!event || event.defaultPrevented) return;
    const form = event.target;
    const submitter = event.submitter || null;
    const subTarget = readDomStringAttr(submitter, 'formtarget', 'formTarget');
    const chosenTarget = subTarget !== null ? subTarget : readDomStringAttr(form, 'target', 'target');
    if (typeof chosenTarget === 'string' && chosenTarget.trim().length > 0 && chosenTarget.trim().toLowerCase() !== '_self') {
      return;
    }
    const subMethod = readDomStringAttr(submitter, 'formmethod', 'formMethod');
    const rawMethod = subMethod !== null && subMethod.trim().length > 0 ? subMethod : readDomStringAttr(form, 'method', 'method');
    const formMethod = typeof rawMethod === 'string' && rawMethod.trim().length > 0 ? rawMethod.trim().toLowerCase() : 'get';
    if (formMethod === 'dialog') return;
    event.preventDefault();
  });
}
`;
}
