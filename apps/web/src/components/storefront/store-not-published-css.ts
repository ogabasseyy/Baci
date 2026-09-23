/**
 * Upcoming-store notice CSS. Keep this a TS string so Next does not emit a
 * render-blocking CSS-module chunk on published storefront HTML.
 */
export const STORE_NOT_PUBLISHED_CSS = `
.unpublished-store {
  --notice-ink: var(--store-background-text, #111827);
  --notice-paper: var(--store-background, #fffdf8);
  --notice-brand: var(--store-primary, #2a2c6e);
  align-items: center;
  background:
    linear-gradient(
      color-mix(in srgb, var(--notice-ink) 5%, transparent) 1px,
      transparent 1px
    ),
    linear-gradient(
      90deg, color-mix(in srgb, var(--notice-ink) 5%, transparent) 1px,
      transparent 1px
    ),
    var(--notice-paper);
  background-size: 42px 42px;
  color: var(--notice-ink);
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 100svh;
  overflow: hidden;
  padding: clamp(1rem, 4vw, 3rem);
  position: relative;
}
.unpublished-store__glow {
  background: var(--notice-brand);
  border-radius: 999px;
  filter: blur(110px);
  height: min(55vw, 34rem);
  opacity: 0.14;
  position: absolute;
  right: -12rem;
  top: -14rem;
  width: min(55vw, 34rem);
}
.unpublished-store__notice {
  animation: unpublished-store-notice-arrive 700ms cubic-bezier(0.22, 1, 0.36, 1) both;
  backdrop-filter: blur(18px);
  background: color-mix(in srgb, var(--notice-paper) 88%, transparent);
  border: 1px solid color-mix(in srgb, var(--notice-ink) 15%, transparent);
  box-shadow: 0 28px 80px color-mix(in srgb, var(--notice-ink) 14%, transparent);
  max-width: 68rem;
  position: relative;
  width: 100%;
}
.unpublished-store__notice::before {
  background: var(--notice-brand);
  content: "";
  height: 4px;
  left: -1px;
  position: absolute;
  right: -1px;
  top: -1px;
}
.unpublished-store__header,
.unpublished-store__footer {
  align-items: center;
  display: flex;
  justify-content: space-between;
  padding: clamp(1.25rem, 3vw, 2rem);
}
.unpublished-store__header {
  border-bottom: 1px solid color-mix(in srgb, var(--notice-ink) 12%, transparent);
}
.unpublished-store__monogram {
  align-items: center;
  aspect-ratio: 1;
  background: var(--notice-ink);
  color: var(--notice-paper);
  display: flex;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 1.15rem;
  justify-content: center;
  width: 2.75rem;
}
.unpublished-store__status {
  align-items: center;
  display: flex;
  font-size: 0.7rem;
  font-weight: 700;
  gap: 0.55rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.unpublished-store__status-dot {
  animation: unpublished-store-status-pulse 2.2s ease-in-out infinite;
  background: var(--notice-brand);
  border-radius: 999px;
  height: 0.5rem;
  width: 0.5rem;
}
.unpublished-store__content {
  max-width: 53rem;
  padding: clamp(3.5rem, 9vw, 8rem) clamp(1.25rem, 7vw, 6rem);
}
.unpublished-store__eyebrow {
  align-items: center;
  color: var(--notice-brand);
  display: flex;
  font-size: 0.72rem;
  font-weight: 750;
  gap: 0.55rem;
  letter-spacing: 0.18em;
  margin-bottom: 1.35rem;
  text-transform: uppercase;
}
.unpublished-store__title {
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(3.25rem, 9vw, 7.5rem);
  font-weight: 400;
  letter-spacing: -0.055em;
  line-height: 0.92;
  margin: 0;
  overflow-wrap: anywhere;
}
.unpublished-store__message {
  color: color-mix(in srgb, var(--notice-ink) 68%, transparent);
  font-size: clamp(1rem, 2vw, 1.18rem);
  line-height: 1.75;
  margin: 2rem 0 0;
  max-width: 38rem;
}
.unpublished-store__footer {
  border-top: 1px solid color-mix(in srgb, var(--notice-ink) 12%, transparent);
  gap: 1rem;
}
.unpublished-store__store-mark,
.unpublished-store__owner-link {
  align-items: center;
  display: flex;
  gap: 0.55rem;
}
.unpublished-store__store-mark {
  color: color-mix(in srgb, var(--notice-ink) 62%, transparent);
  font-size: 0.82rem;
}
.unpublished-store__owner-link {
  color: var(--notice-ink);
  font-size: 0.82rem;
  font-weight: 700;
  text-decoration-color: color-mix(in srgb, var(--notice-brand) 45%, transparent);
  text-underline-offset: 0.35rem;
}
.unpublished-store__owner-link:hover {
  color: var(--notice-brand);
}
.unpublished-store__signature {
  color: color-mix(in srgb, var(--notice-ink) 50%, transparent);
  font-size: 0.68rem;
  letter-spacing: 0.12em;
  margin-top: 1.25rem;
  text-transform: uppercase;
}
@keyframes unpublished-store-notice-arrive {
  from { opacity: 0; transform: translateY(18px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes unpublished-store-status-pulse {
  50% {
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--notice-brand) 12%, transparent);
  }
}
@media (max-width: 40rem) {
  .unpublished-store__footer {
    align-items: flex-start;
    flex-direction: column;
  }
  .unpublished-store__content {
    padding-bottom: 4.5rem;
    padding-top: 4.5rem;
  }
}
@media (prefers-reduced-motion: reduce) {
  .unpublished-store__notice,
  .unpublished-store__status-dot {
    animation: none;
  }
}
`;
