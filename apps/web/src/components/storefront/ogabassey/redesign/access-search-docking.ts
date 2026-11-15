/** Keep the same form mounted so typing and keyboard focus survive docking. */
export function attachSearchDocking(
  slot: HTMLElement,
  header: HTMLElement | null
) {
  if (typeof IntersectionObserver === 'undefined') return;

  const initialHeaderDocked = header?.dataset.oaSearchDocked;
  let docked: boolean | undefined;
  let top = -1;
  let inlineHeight = 0;
  let intersection: IntersectionObserver | undefined;
  let outsideViewportScrollY: number | undefined;

  const setDocked = (next: boolean) => {
    if (next === docked) return;
    docked = next;
    slot.dataset.docked = String(docked);
    if (!header) return;
    if (docked) header.dataset.oaSearchDocked = 'true';
    else if (initialHeaderDocked === undefined) {
      delete header.dataset.oaSearchDocked;
    } else header.dataset.oaSearchDocked = initialHeaderDocked;
  };

  const measure = () => {
    const { bottom, height, top: slotTop } = slot.getBoundingClientRect();
    outsideViewportScrollY =
      bottom < top || slotTop > window.innerHeight ? window.scrollY : undefined;
    if (!docked && height !== inlineHeight) {
      inlineHeight = height;
      slot.style.setProperty('--oa-search-slot-height', `${height}px`);
    }
    setDocked(bottom < top);
  };

  const refresh = () => {
    const headerHeight = header?.offsetHeight ?? 0;
    if (top !== headerHeight) {
      top = headerHeight;
      slot.style.setProperty('--oa-search-top', `${top}px`);
      intersection?.disconnect();
      intersection = new IntersectionObserver(
        (entries, observer) => {
          // Delivery can lag behind a scroll jump. Read the current slot and
          // scroll position together when the observer reports a crossing.
          if (entries.length && observer === intersection) measure();
        },
        { rootMargin: `${-top}px 0px 0px 0px` }
      );
      intersection.observe(slot);
    }
    measure();
  };

  refresh();
  const resize =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          if (intersection) refresh();
        });
  resize?.observe(slot, { box: 'border-box' });
  if (header) resize?.observe(header, { box: 'border-box' });
  window.addEventListener('resize', refresh);
  // A single large jump can move the slot between opposite edges without
  // intersecting the viewport. Reconcile after scrolling settles.
  const reconcileScrollJump = () => {
    if (outsideViewportScrollY === undefined) return;
    const distance = window.scrollY - outsideViewportScrollY;
    const viewportHeight = Math.max(0, window.innerHeight - top);
    if (docked ? distance < -viewportHeight : distance > viewportHeight) {
      measure();
    }
  };
  document.addEventListener('scrollend', reconcileScrollJump);

  return () => {
    intersection?.disconnect();
    intersection = undefined;
    resize?.disconnect();
    window.removeEventListener('resize', refresh);
    document.removeEventListener('scrollend', reconcileScrollJump);
    setDocked(false);
    delete slot.dataset.docked;
    slot.style.removeProperty('--oa-search-top');
    slot.style.removeProperty('--oa-search-slot-height');
  };
}
