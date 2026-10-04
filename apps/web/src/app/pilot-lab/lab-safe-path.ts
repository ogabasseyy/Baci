// Fail-fast relative-path validation for pilot-lab operator inputs.
// Mirrors the transformer-side isConfinedRelativePath (job-schema.mjs)
// and the preflight mirror (preflight-records.mjs): length cap, no
// control characters, no encoded separators, no absolute/empty/dot
// segments. Traversal is also blocked downstream by readVerifiedSnapshot's
// realpath confinement; this is the input-validation layer with lab
// errors instead of incidental throws.
const ENCODED_SEPARATOR_PATTERN = /%(2f|5c|00)/i;

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) {
      return true;
    }
  }
  return false;
}

// Every decode layer (capped): %252f (double) and deeper nestings must
// not smuggle separators past the single-pattern check — intermediates
// matter, not just the fixpoint. Malformed sequences stop decoding and
// validate as-is; overlong-UTF-8 forms that no decoder accepts stay
// blocked downstream by realpath confinement.
function decodeLayers(value: string): string[] {
  const layers = [value];
  let current = value;
  for (let depth = 0; depth < 8; depth += 1) {
    let next = current;
    try {
      next = decodeURIComponent(current);
    } catch {
      return layers;
    }
    if (next === current) {
      return layers;
    }
    layers.push(next);
    current = next;
  }
  return layers;
}

export function isSafeRelativePath(value: string): boolean {
  if (value.length < 1 || value.length > 256) {
    return false;
  }
  return decodeLayers(value).every((layer) => {
    if (
      layer.startsWith('/') ||
      layer.includes('\\') ||
      hasControlCharacter(layer) ||
      ENCODED_SEPARATOR_PATTERN.test(layer)
    ) {
      return false;
    }
    return !layer
      .split('/')
      .some((segment) => segment === '' || segment === '.' || segment === '..');
  });
}
