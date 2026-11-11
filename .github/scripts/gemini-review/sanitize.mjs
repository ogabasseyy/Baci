// Scrubs model-written text before it is posted to a pull request. The text is derived from
// attacker-influenced input (the diff), so it must not leak secrets, ping people, load remote
// images (an exfiltration channel) or forge the hidden markers this workflow reads back.

const ZERO_WIDTH_SPACE = '​';

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

// Links and URLs outside code become inline code, so GitHub does not make them clickable: a
// prompt-injected review must not post trusted-looking links under the bot's name. Code spans and
// fences are left alone (the URL there is already inert).
const CODE = /(```[\s\S]*?```|`[^`\n]*`)/;

function defuseLinks(text) {
  return text
    .split(CODE)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part
            .replace(/\[([^\]\n]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/g, (_match, label, url) =>
              url ? `${label} (\`${url.replaceAll('`', '')}\`)` : label,
            )
            .replace(/<((?:https?|ftp):\/\/[^>\s]+)>/gi, (_match, url) => `\`${url.replaceAll('`', '')}\``)
            .replace(/(?<!`)\b(?:https?|ftp):\/\/[^\s<>`)\]]+/gi, (url) => `\`${url}\``),
    )
    .join('');
}

export function sanitizeText(input, { max = 2000 } = {}) {
  let text = input === undefined || input === null ? '' : String(input);
  text = text.replaceAll('\r\n', '\n');

  // Redact first: truncating first could cut a secret in half and defeat the patterns.
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, '[redacted]');
  text = text.replace(KEY_VALUE, '$1$2$3[redacted]$3');

  text = text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!--[\s\S]*$/, '')
    // Inline, reference (full and collapsed) and shortcut images, then every link definition (an
    // image reference needs one to load), then any "![" left over so nothing can render an image.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_match, alt) => alt || 'image removed')
    .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, (_match, alt) => alt || 'image removed')
    .replace(/!\[([^\]]*)\](?![([:])/g, (_match, alt) => alt || 'image removed')
    .replace(/^ {0,3}\[[^\]\n]+\]:[ \t]*\S.*$/gm, '')
    .replaceAll('![', `!${ZERO_WIDTH_SPACE}[`)
    .replace(RISKY_TAG, '')
    .replace(/(^|[^A-Za-z0-9_@])@(?=[A-Za-z0-9_])/g, `$1@${ZERO_WIDTH_SPACE}`);
  text = defuseLinks(text);

  if (text.length > max) {
    return `${text.slice(0, Math.max(0, max - 1))}…`;
  }
  return text;
}
