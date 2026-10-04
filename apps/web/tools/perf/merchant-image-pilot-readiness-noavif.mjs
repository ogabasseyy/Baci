// No-AVIF fallback proof for the readiness gate: on profiles that strip
// AVIF candidates from the served pilot document, the run must show
// stripped candidates (non-vacuous), zero AVIF bytes fetched, and at
// least one WebP fallback fetched. Split from the surface checks under
// the repo line ceiling; per-image non-AVIF selection stays with the
// staged-image verdicts.

function servedPathnames(collected) {
  return (collected.imageUrls ?? []).flatMap((url) => {
    try {
      return [new URL(url).pathname];
    } catch {
      return [];
    }
  });
}

export function noAvifSurfaceProblems(collected, arm) {
  if (arm !== 'pilot') {
    return [];
  }
  const problems = [];
  if ((collected.strippedAvif ?? 0) < 1) {
    problems.push('no-avif run stripped no AVIF candidates');
  }
  const servedAvif = servedPathnames(collected).filter((pathname) =>
    pathname.endsWith('.avif')
  );
  if (servedAvif.length > 0) {
    const first = (collected.imageUrls ?? []).find((url) => {
      try {
        return new URL(url).pathname.endsWith('.avif');
      } catch {
        return false;
      }
    });
    problems.push(`no-avif run fetched AVIF bytes: ${first}`);
  }
  const servedWebp = servedPathnames(collected).filter((pathname) =>
    pathname.endsWith('.webp')
  );
  if (servedWebp.length === 0) {
    problems.push('no-avif run fetched no WebP fallback');
  }
  return problems;
}
