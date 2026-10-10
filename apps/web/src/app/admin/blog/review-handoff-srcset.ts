function isCandidateBoundary(current: string, piece: string): boolean {
  // Mirror the WHATWG "parse a srcset attribute" splitting loop: a comma
  // ends a candidate only when the accumulated text already holds a
  // complete `url [descriptors]` run (it contains whitespace) or the comma
  // itself is followed by whitespace (a trailing-comma separator). A bare
  // comma inside a whitespace-free run is part of the URL token — path
  // segments, query values, and data: payloads may all legally contain
  // commas (RFC 3986 sub-delims) — so it glues and the joined token is
  // validated as one candidate. The next piece is never classified: the
  // browser does not split `a,b 2x` into a relative second candidate, it
  // requests the comma-bearing URL as one resource.
  if (/\s/.test(current)) {
    return true;
  }
  return /^\s/.test(piece);
}

export function splitSrcsetCandidates(srcset: string): string[] {
  const candidates: string[] = [];
  // A comma ends a candidate at a candidate boundary (see above). Every
  // emitted candidate — glued or split — is URL-validated, so a glued
  // token still fails closed whenever it is not an absolute HTTPS URL.
  let current = '';
  for (const piece of srcset.split(',')) {
    if (piece.trim() === '') continue;
    if (current !== '' && isCandidateBoundary(current, piece)) {
      candidates.push(current);
      // A new candidate starts trimmed: like the WHATWG splitting loop,
      // separator whitespace is skipped rather than accumulated.
      current = piece.trim();
    } else if (current === '') {
      current = piece.trim();
    } else {
      current += `,${piece}`;
    }
  }
  if (current !== '') candidates.push(current);
  return candidates;
}
