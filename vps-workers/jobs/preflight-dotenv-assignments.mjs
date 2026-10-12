import { parse } from 'dotenv';

// Dotenv/shell-boundary anomaly scanners for the direct-worker
// preflight: extracted from preflight-direct-web-workers.mjs to keep
// both modules under the 300-line limit. The preflight's credential
// validation imports these; the finders never import the preflight.

// dotenv accepts multiline quoted values, but the shell reader
// (gigl-dotenv.sh) is line-oriented: it would hand the poller the
// first line while dotenv-based checks validated the whole value (or
// a spanning value swallowing later assignments). The keys below are
// exactly the ones the shell boundary reads (the filter allowlist
// plus the latch/fallback identity keys); an unterminated quote on
// any of their lines fails the preflight loudly instead of diverging
// silently. Other workers may keep multiline values.
const SHELL_READ_KEYS = new Set([
  'BACI_REPO_DIR',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
]);

function isShellReadKey(name) {
  return SHELL_READ_KEYS.has(name) || name.startsWith('GIGL_');
}

export function findMultilineDotenvAssignments(text) {
  // Grounded in dotenv itself, not a hand-rolled quote scan and not
  // the parsed value's bytes: `"a\nb"` parses to an embedded LF yet
  // is one physical line the shell reads exactly, so byte-sniffing
  // the value false-positives. Instead, compare dotenv's full-file
  // value for each shell-read key against dotenv's parse of the key's
  // last shell-effective physical line (mirroring gigl-dotenv.sh's
  // line matching and last-wins, after its CR truncation): equal
  // means the line-oriented reader sees what the preflight validated
  // — given reader parity — while any difference means the value
  // genuinely spans lines (or is shadowed by a span) and the shell
  // would hand the poller different bytes. A span swallowing a
  // shell-read key's line removes the key from the full parse; that
  // stays silent here and surfaces as a missing key in the
  // required-value check instead. Separators also span: dotenv
  // accepts whitespace across `=`/`:` (`KEY:` or a bare `KEY` line
  // followed by the value), which no physical line assigns in shell
  // form — the shell reader then misses a key the required check
  // passes, so keys dotenv parsed without any shell-effective line
  // are offenders too (blank values excepted: shell-empty and
  // dotenv-empty agree, and the required check reports them missing).
  const full = parse(text);
  const lines = text.split('\n');
  const lastLineByKey = new Map();
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.replace(/\r.*$/, '');
    const match = line.match(
      /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)(?::[ \t]|[ \t]*=)/
    );
    if (match === null || !isShellReadKey(match[1])) {
      continue;
    }
    lastLineByKey.set(match[1], { index, line });
  }
  const offenders = [];
  for (const [key, { index, line }] of lastLineByKey) {
    if (!(key in full)) {
      continue;
    }
    const single = parse(line);
    if (!(key in single) || single[key] !== full[key]) {
      offenders.push(`${key} (line ${index + 1})`);
    }
  }
  for (const key of Object.keys(full)) {
    // The shell boundary only ever addresses identifier keys (the
    // scoped-env enumerator matches GIGL_[A-Za-z0-9_]*); dotenv's
    // dotted/dashed keys are unreadable there, so they cannot diverge.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    if (!isShellReadKey(key) || lastLineByKey.has(key)) {
      continue;
    }
    if ((full[key] ?? '').trim() === '') {
      continue;
    }
    const blame = lastKeyMentionIndex(lines, key);
    offenders.push(blame >= 0 ? `${key} (line ${blame + 1})` : key);
  }
  return offenders;
}

function lastKeyMentionIndex(lines, key) {
  // Locate dotenv's match for blame: unlike the shell matcher above,
  // dotenv's line anchor and export prefix accept any whitespace.
  for (let index = lines.length - 1; index >= 0; index--) {
    const text = lines[index]
      .replace(/\r.*$/, '')
      .replace(/^\s*/, '')
      .replace(/^export\s+/, '');
    if (
      text === key ||
      (text.startsWith(key) && !/[\w.-]/.test(text[key.length] ?? ''))
    ) {
      return index;
    }
  }
  return -1;
}

// dotenv expands `\n` inside double quotes, but the shell boundary
// captures values through command substitution, which strips trailing
// line feeds: `GIGL_PASSWORD="abc\n"` validates as four bytes while
// cron exports three. Only a TRAILING line feed diverges (a mid-value
// escape survives capture on both sides), so reject exactly that:
// shell-read keys whose parsed value ends with `\n`. Unterminated
// (true multiline) values are rejected above; this catches the
// single-line escape the quote check accepts.
export function findTrailingNewlineValues(env) {
  const offenders = [];
  for (const name of Object.keys(env)) {
    if (!isShellReadKey(name)) {
      continue;
    }
    if ((env[name] ?? '').endsWith('\n')) {
      offenders.push(name);
    }
  }
  return offenders;
}
