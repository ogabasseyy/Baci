// Tag matcher for the handoff validators: open and close tags with
// quoted attributes that may contain `>`. Comments never match,
// so callers strip them before matching.
export const HTML_TAG_PATTERN =
  /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/g;
