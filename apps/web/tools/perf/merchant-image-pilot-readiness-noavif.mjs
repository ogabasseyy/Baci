// No-AVIF fallback proof: Chromium format emulation preserves the markup.
// The run must show retained AVIF candidates (non-vacuous), zero AVIF bytes, and
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
  if (collected.avifDisabled !== true) {
    problems.push('no-avif run did not confirm browser format emulation');
  }
  if ((collected.geometry?.avifCandidates ?? 0) < 1) {
    problems.push('no-avif run has no retained AVIF candidates');
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
