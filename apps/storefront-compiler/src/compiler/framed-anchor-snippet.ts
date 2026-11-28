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

function attachFramedNavigationInterceptors(container, commerce, initialProps, getPathname, onPendingQuerySearch) {
  const roots = [];
  if (container && typeof container.addEventListener === 'function') roots.push(container);
  if (typeof document !== 'undefined' && document !== container && typeof document.addEventListener === 'function') {
    roots.push(document);
  }
  if (!window.parent || window.parent === window || roots.length === 0) {
    return;
  }
  const seenClicks = typeof WeakSet === 'function' ? new WeakSet() : null;
  const seenSubmits = typeof WeakSet === 'function' ? new WeakSet() : null;
  const slug = typeof initialProps?.merchantSlug === 'string' && initialProps.merchantSlug.length > 0 ? initialProps.merchantSlug : 'store';
  const getBaseHref = () => {
    if (typeof document !== 'undefined' && typeof document.baseURI === 'string' && /^https?:\\/\\//i.test(document.baseURI)) {
      return document.baseURI;
    }
    const livePath = typeof getPathname === 'function' ? getPathname() : initialProps?.pathname;
    const safePath = typeof livePath === 'string' && livePath.startsWith('/') ? livePath : '/';
    return \`https://\${slug}.usebaci.com\${safePath}\`;
  };
  const isStorefrontCanonicalOrigin = (origin, baseOrigin) =>
    origin === baseOrigin ||
    origin === \`https://\${slug}.usebaci.com\` ||
    (typeof TRUSTED_HOST_ORIGIN === 'string' && TRUSTED_HOST_ORIGIN.length > 0 && origin === TRUSTED_HOST_ORIGIN);

  const handleClick = (boundRoot) => (event) => {
    if (!event || event.defaultPrevented) return;
    const isAuxClick = event.type === 'auxclick';
    if (event.type !== 'click' && !isAuxClick) return;
    if (isAuxClick ? event.button !== 1 : (typeof event.button === 'number' && event.button !== 0)) return;
    if (event.altKey) return;
    if (seenClicks && typeof event === 'object') {
      if (seenClicks.has(event)) return;
      seenClicks.add(event);
    }
    let node = event.target;
    while (node && node !== boundRoot) {
      const tag = typeof node.tagName === 'string' ? node.tagName.toUpperCase() : '';
      if (tag === 'A' || tag === 'AREA') break;
      node = node.parentElement || node.parentNode;
    }
    const foundTag = node && typeof node.tagName === 'string' ? node.tagName.toUpperCase() : '';
    if (foundTag !== 'A' && foundTag !== 'AREA') return;
    const targetAttr = readDomStringAttr(node, 'target', 'target');
    const normalizedTarget = typeof targetAttr === 'string' ? targetAttr.trim().toLowerCase() : '';
    if (normalizedTarget.length > 0 && normalizedTarget !== '_self' && normalizedTarget !== '_blank') {
      event.preventDefault();
      return;
    }
    const wantsNewTab =
      normalizedTarget === '_blank' ||
      isAuxClick ||
      event.button === 1 ||
      Boolean(event.metaKey || event.ctrlKey || event.shiftKey);
    const rawHref = readDomStringAttr(node, 'href', 'href');
    if (typeof rawHref !== 'string' || rawHref.length === 0 || rawHref.startsWith('#')) return;
    try {
      const baseHref = getBaseHref();
      const baseOrigin = new URL(baseHref).origin;
      const parsed = new URL(rawHref, baseHref);
      if (!isStorefrontCanonicalOrigin(parsed.origin, baseOrigin)) {
        event.preventDefault();
        return;
      }
      if ((rawHref.startsWith('/') && rawHref.includes('//')) || /[%\\\\]/.test(rawHref) || parsed.pathname.includes('//')) {
        event.preventDefault();
        return;
      }
      if (parsed.pathname === '/checkout' || parsed.pathname.startsWith('/checkout/')) {
        event.preventDefault();
        void commerce.checkout.open();
        return;
      }
      const scrollHashTarget = () => {
        if (!parsed.hash) return;
        try {
          const fragId = decodeURIComponent(parsed.hash.slice(1));
          if (fragId && typeof document !== 'undefined' && typeof document.getElementById === 'function') {
            document.getElementById(fragId)?.scrollIntoView?.();
          }
        } catch {}
      };
      if (!parsed.search && parsed.hash && !wantsNewTab) {
        const livePath = typeof getPathname === 'function' ? getPathname() : initialProps?.pathname;
        const curPath = typeof livePath === 'string' && livePath.startsWith('/') ? livePath : '/';
        if (parsed.pathname === curPath) {
          event.preventDefault();
          scrollHashTarget();
          return;
        }
      }
      event.preventDefault();
      const rememberQuery = () => {
        if (parsed.search && typeof onPendingQuerySearch === 'function') {
          onPendingQuerySearch(parsed.pathname, parsed.search);
        }
      };
      if (wantsNewTab) {
        const openDest = parsed.pathname + parsed.search + parsed.hash;
        void Promise.resolve(commerce.navigation.open(openDest)).then((res) => {
          const fallbackSameFrame =
            res &&
            ((res.status === 'ok' && res.value && res.value.presented === false) ||
              (res.status === 'error' && res.code === 'INVALID_REQUEST' && Boolean(parsed.search || parsed.hash)));
          if (fallbackSameFrame) {
            rememberQuery();
            void Promise.resolve(commerce.navigation.go(parsed.pathname)).then((goRes) => {
              if (goRes && goRes.status === 'ok' && parsed.hash && typeof setTimeout === 'function') {
                setTimeout(scrollHashTarget, 0);
              }
            });
          }
        });
      } else {
        rememberQuery();
        void Promise.resolve(commerce.navigation.go(parsed.pathname)).then((goRes) => {
          if (goRes && goRes.status === 'ok' && parsed.hash && typeof setTimeout === 'function') {
            setTimeout(scrollHashTarget, 0);
          }
        });
      }
    } catch {}
  };

  const handleSubmit = (event) => {
    if (!event || event.defaultPrevented) return;
    if (seenSubmits && typeof event === 'object') {
      if (seenSubmits.has(event)) return;
      seenSubmits.add(event);
    }
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
  };

  const disarmImmediateStop = (event) => {
    if (!event || typeof event !== 'object') return;
    try {
      const fallbackStop = typeof event.stopPropagation === 'function' ? event.stopPropagation.bind(event) : null;
      Object.defineProperty(event, 'stopImmediatePropagation', {
        configurable: true,
        value: () => {
          if (fallbackStop) fallbackStop();
        },
      });
    } catch {}
  };
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('click', disarmImmediateStop, true);
    window.addEventListener('auxclick', disarmImmediateStop, true);
    window.addEventListener('submit', disarmImmediateStop, true);
  }
  for (const r of roots) {
    const onRootClick = handleClick(r);
    r.addEventListener('click', onRootClick);
    r.addEventListener('auxclick', onRootClick);
    r.addEventListener('submit', handleSubmit);
  }
}
`;
}
