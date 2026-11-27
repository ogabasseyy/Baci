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

function serializeGetFormParams(form, submitter) {
  const params = new URLSearchParams();
  if (!form) return params;
  if (typeof FormData === 'function' && typeof HTMLFormElement === 'function' && form instanceof HTMLFormElement) {
    let fd = null;
    if (submitter && typeof HTMLElement === 'function' && submitter instanceof HTMLElement) {
      try {
        fd = new FormData(form, submitter);
      } catch {}
    }
    if (!fd) {
      fd = new FormData(form);
      if (submitter && !submitter.disabled && typeof submitter.name === 'string' && submitter.name.length > 0) {
        fd.append(submitter.name, typeof submitter.value === 'string' ? submitter.value : '');
      }
    }
    for (const [k, v] of fd.entries()) {
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
  if (submitter && !submitter.disabled && typeof submitter.name === 'string' && submitter.name.length > 0) {
    params.append(submitter.name, typeof submitter.value === 'string' ? submitter.value : '');
  }
  return params;
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
    const rawHref = readDomStringAttr(node, 'href', 'href');
    if (typeof rawHref !== 'string' || rawHref.length === 0 || rawHref.startsWith('#')) return;
    event.preventDefault();
    const targetAttr = readDomStringAttr(node, 'target', 'target');
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
    const form = event.target;
    const submitter = event.submitter || null;
    const subMethod = readDomStringAttr(submitter, 'formmethod', 'formMethod');
    const rawMethod = subMethod !== null && subMethod.trim().length > 0 ? subMethod : readDomStringAttr(form, 'method', 'method');
    const formMethod = typeof rawMethod === 'string' && rawMethod.trim().length > 0 ? rawMethod.trim().toLowerCase() : 'get';
    if (formMethod === 'dialog') return;
    event.preventDefault();
    if (formMethod !== 'get') return;
    const subAction = readDomStringAttr(submitter, 'formaction', 'formAction');
    const formAction = readDomStringAttr(form, 'action', 'action');
    const chosenAction = subAction !== null ? subAction : formAction;
    const subTarget = readDomStringAttr(submitter, 'formtarget', 'formTarget');
    const chosenTarget = subTarget !== null && subTarget.length > 0 ? subTarget : readDomStringAttr(form, 'target', 'target');
    try {
      const baseHref = getBaseHref();
      const baseOrigin = new URL(baseHref).origin;
      const effectiveAction = typeof chosenAction === 'string' && chosenAction.length > 0 ? chosenAction : baseHref;
      const parsed = new URL(effectiveAction, baseHref);
      if (!isPermittedTargetOrigin(parsed.origin, baseOrigin)) return;
      if (parsed.pathname === '/checkout' || parsed.pathname.startsWith('/checkout/')) {
        void commerce.checkout.open();
        return;
      }
      const qs = serializeGetFormParams(form, submitter).toString();
      parsed.search = qs ? \`?\${qs}\` : '';
      const rel = parsed.pathname + parsed.search + parsed.hash;
      void (chosenTarget === '_blank' ? commerce.navigation.open(rel) : commerce.navigation.go(rel));
    } catch {}
  });
}
`;
}
