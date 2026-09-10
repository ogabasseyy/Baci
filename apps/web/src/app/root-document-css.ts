/**
 * First-paint document CSS that must not become a render-blocking stylesheet.
 * next/font Inter @font-face (even display:optional) stayed in a linked sheet
 * and Lantern still modeled a ~3s text LCP. Keep Inter Fallback + skip-link here.
 * Do not put a woff2 `url()` in this string — Lantern treats it as LCP-critical
 * even when unicode-range does not match the heading and Chrome never fetches it.
 */
export const ROOT_DOCUMENT_CSS = `
@font-face {
  font-family: "Inter Fallback";
  src: local(Arial);
  ascent-override: 90.44%;
  descent-override: 22.52%;
  line-gap-override: 0%;
  size-adjust: 107.12%;
}

:root {
  --font-sans: "Inter Fallback", Arial, Helvetica, sans-serif;
  --font-naira: "Inter Naira", "Inter Fallback";
}

html, body {
  font-family: "Inter Fallback", Arial, Helvetica, sans-serif;
}

.baci-skip-link {
  clip-path: inset(50%);
  border-width: 0;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  padding: 0;
  position: absolute;
  white-space: nowrap;
  width: 1px;
}

.baci-skip-link:focus-visible {
  clip-path: none;
  background: hsl(var(--primary, 239 45% 30%));
  border-radius: 0.375rem;
  color: hsl(var(--primary-foreground, 0 0% 98%));
  height: auto;
  left: 1rem;
  margin: 0;
  outline: 2px solid hsl(var(--ring, 239 45% 30%));
  outline-offset: 2px;
  overflow: visible;
  padding: 0.5rem 1rem;
  position: absolute;
  top: 1rem;
  white-space: normal;
  width: auto;
  z-index: 9999;
}
`;
