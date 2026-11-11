// Scrubs model-written text before it is posted to a pull request. The text is derived from
// attacker-influenced input (the diff), so it must not leak secrets, ping people, load remote
// images (an exfiltration channel) or forge the hidden markers this workflow reads back.

const ZERO_WIDTH_SPACE = '\u200b';

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
];

// name = "value" / name: value, where the name looks like a credential.
const KEY_VALUE = /\b([A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|passw(?:or)?d)[A-Za-z0-9_.-]*)(\s*[:=]\s*)(["']?)[A-Za-z0-9/+_=-]{16,}\3/gi;

const RISKY_TAG = /<\/?(?:img|picture|source|video|audio|iframe|script|style|link|object|embed|svg|form|input)\b[^>]*>/gi;

// Removing active markup can BUILD new active markup (`<im<img>g src=...>` loses the inner tag and
// becomes a valid `<img>`), so every removal runs until the text stops changing.
const untilStable = (text, transform) => {
  let current = text;
  for (let round = 0; round < 10; round += 1) {
    const next = transform(current);
    if (next === current) break;
    current = next;
  }
  return current;
};

// What counts as code is decided by GitHub, not by us, so only text that GitHub certainly renders
// as code is exempt: an inline span is a run of 1-3 backticks, backtick-free text on one line, and
// a closing run of the SAME length; a fence opens at a line start (up to 3 spaces) and is closed by
// a fence line at least as long. Anything that merely looks like code (escaped or mismatched
// backticks, a "fence" that spans paragraphs) is treated as ordinary text and made inert.
const CODE = /(^ {0,3}(`{3,})[^\n`]*\n[\s\S]*?\n {0,3}\2`*[ \t]*(?=\n|$)|(?<!`)(`{1,3})(?!`)[^`\n]+\3(?!`))/gm;

function segments(text) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(CODE)) {
    parts.push({ code: false, text: text.slice(last, match.index) }, { code: true, text: match[0] });
    last = match.index + match[0].length;
  }
  parts.push({ code: false, text: text.slice(last) });
  return parts;
}

// Links and URLs outside code are defanged, so GitHub does not make them clickable: a
// prompt-injected review must not post trusted-looking links under the bot's name. A zero-width
// space after the scheme ("https:\u200b//") or after "www" stops GitHub's autolinking while the text
// stays readable. (Wrapping URLs in backticks would not be safe: a stray backtick next to the
// URL changes the backtick run lengths and the URL ends up outside the code span again.)
const defang = (url) => url.replace(/^(https?|ftp):\/\//i, `$1:${ZERO_WIDTH_SPACE}//`).replace(/^www\./i, `www${ZERO_WIDTH_SPACE}.`);

const defuseLinksIn = (part) =>
  part
    .replace(/\[([^\]\n]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/g, (_match, label, url) => (url ? `${label} (${defang(url)})` : label))
    .replace(/<((?:https?|ftp):\/\/[^>\s]+)>/gi, (_match, url) => defang(url))
    .replace(/\b(?:https?|ftp):\/\/[^\s<>)\]]+/gi, defang)
    .replace(/(?<![\w/.@-])www\./gi, (match) => defang(match));

// What is left after all removals: any "<" that could still start a tag, comment or declaration is
// escaped, so the text can never contain HTML (the entity renders as a plain "<").
const escapeHtmlIn = (part) => part.replace(/<(?=[A-Za-z/!?])/g, '&lt;');

function inertOutsideCode(text) {
  return segments(text)
    .map((part) => (part.code ? part.text : escapeHtmlIn(untilStable(part.text, defuseLinksIn))))
    .join('');
}

export function sanitizeText(input, { max = 2000 } = {}) {
  let text = input === undefined || input === null ? '' : String(input);
  text = text.replaceAll('\r\n', '\n');
  // A backslash before a backtick makes it a literal character on GitHub. Drop those backslashes so
  // the backticks are read the same way here as there (otherwise "\\`<a href=x>\\`" would look like code).
  text = text.replace(/\\+`/g, '`');

  // Redact first: truncating first could cut a secret in half and defeat the patterns.
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, '[redacted]');
  text = text.replace(KEY_VALUE, '$1$2$3[redacted]$3');

  text = untilStable(text, (current) => current.replace(/<!--[\s\S]*?-->/g, '').replace(/<!--[\s\S]*$/, ''));
  // Inline, reference (full and collapsed) and shortcut images, then every link definition (an
  // image reference needs one to load), then any "![" left over so nothing can render an image.
  text = untilStable(text, (current) =>
    current
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_match, alt) => alt || 'image removed')
      .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, (_match, alt) => alt || 'image removed')
      .replace(/!\[([^\]]*)\](?![([:])/g, (_match, alt) => alt || 'image removed'),
  );
  text = text.replace(/^ {0,3}\[[^\]\n]+\]:[ \t]*\S.*$/gm, '').replaceAll('![', `!${ZERO_WIDTH_SPACE}[`);
  text = untilStable(text, (current) => current.replace(RISKY_TAG, ''));
  text = text.replace(/(^|[^A-Za-z0-9_@])@(?=[A-Za-z0-9_])/g, `$1@${ZERO_WIDTH_SPACE}`);
  text = inertOutsideCode(text);

  if (text.length > max) {
    return `${text.slice(0, Math.max(0, max - 1))}…`;
  }
  return text;
}
