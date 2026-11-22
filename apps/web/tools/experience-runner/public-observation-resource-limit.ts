// 32 manifest assets, JS/CSS, 128 public pages, 128 frames and 128 Next assets.
export const MAX_PUBLIC_OBSERVATION_RESOURCES = 32 + 2 + 128 + 128 + 128;

export const MAX_PUBLIC_RESOURCE_BYTES = 2 * 1024 ** 2;
export const MAX_PUBLIC_FETCH_BYTES = 16 * 1024 ** 2;

// The verifier fetches output, pages, frames and framework assets separately.
export const MAX_PUBLIC_OBSERVATION_BYTES = 4 * MAX_PUBLIC_FETCH_BYTES;
// Allow for base64, per-resource response headers and JSON metadata.
export const MAX_PUBLIC_OBSERVATION_START_BYTES = 128 * 1024 ** 2;

// A terminal result can include 128 routes with titles, paths and canonical URLs.
export const MAX_PUBLIC_OBSERVATION_OUTPUT_BYTES = 768 * 1024;
