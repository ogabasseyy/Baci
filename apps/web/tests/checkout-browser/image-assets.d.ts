/**
 * Ambient image-module declarations for the checkout-browser program.
 *
 * `tsconfig.checkout-browser.json` narrows `include` to `tests/checkout-browser`,
 * so the generated `next-env.d.ts` (which normally supplies Next's image
 * declarations) is outside the program. Without these declarations, any
 * `*.png` import reached from the harness resolves to `TS2307`.
 */
declare module '*.png' {
  const content: import('next/image').StaticImageData;
  export default content;
}

declare module '*.jpg' {
  const content: import('next/image').StaticImageData;
  export default content;
}

declare module '*.jpeg' {
  const content: import('next/image').StaticImageData;
  export default content;
}

declare module '*.webp' {
  const content: import('next/image').StaticImageData;
  export default content;
}

declare module '*.svg' {
  const content: import('next/image').StaticImageData;
  export default content;
}
