// Validates the owner-readable change summary and reads the PR body's
// sandbox-evidence or dark-until statement. The summary is for a
// non-developer owner, so code, SQL and markup are rejected outright.

const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SIGNOFF_LINE = /^owner sign-off:\s*(.*?)\s*$/i;
const TASK_LINE = /^task:\s*(.*?)\s*$/i;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;

const SQL_PATTERNS = [
  /\b(?:SELECT|INSERT|UPDATE|DELETE)\b.*\b(?:FROM|INTO|SET|WHERE)\b/,
  /\b(?:create|alter|drop)\s+(?:or\s+replace\s+)?(?:table|function|policy|index|view|schema|role|trigger|type|extension)\b/i,
  /\b(?:insert\s+into|delete\s+from|truncate\s+table|security\s+definer|language\s+plpgsql|returns\s+table)\b/i,
  /\b(?:grant|revoke)\s+(?:all|select|insert|update|delete|execute|usage)\b/i,
  /\bselect\b.*\bfrom\b.*\bwhere\b/i,
];

const CODE_PATTERNS = [
  [/=>|===|!==|&&|\|\||::|\(\)\s*;|[{}]/, 'contains code'],
  [
    /\b(?:const|let|var)\s+\w+\s*=|\bfunction\s*\w*\s*\(|\bimport\s+.+\s+from\s+['"]/,
    'contains code',
  ],
  [
    /\b[a-z][a-z0-9]*_[a-z0-9_]*[a-z0-9]\b/,
    'contains a code identifier (a word with underscores)',
  ],
  [
    /<\/?[a-z][\w-]*(?:\s[^>]*)?\/?>/i,
    'contains markup or an unfilled <placeholder>',
  ],
];

export function countWords(text) {
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token))
    .length;
}

function stripComments(text, errors) {
  // Keep the line breaks so reported line numbers match the file.
  const stripped = text.replace(/<!--[\s\S]*?-->/g, (comment) =>
    comment.replace(/[^\n]/g, '')
  );
  if (stripped.includes('<!--'))
    errors.push('Has an HTML comment that is never closed.');
  return stripped;
}

function checkPlainEnglish(lines, errors) {
  lines.forEach((line, index) => {
    const where = `line ${index + 1}`;
    // A well-formed task id may contain underscores; it is not prose.
    if (TASK_ID.test(TASK_LINE.exec(line.trim())?.[1] ?? '')) return;
    if (/^\s*(?:```|~~~)/.test(line))
      errors.push(`Has a code block (${where}).`);
    if (line.includes('`')) errors.push(`Uses backticks for code (${where}).`);
    if (/^(?: {4,}|\t)/.test(line) && line.trim() && !LIST_ITEM.test(line)) {
      errors.push(
        `Has an indented code line (${where}); do not indent paragraphs.`
      );
    }
    if (SQL_PATTERNS.some((pattern) => pattern.test(line)))
      errors.push(`Contains SQL (${where}).`);
    for (const [pattern, message] of CODE_PATTERNS) {
      if (pattern.test(line))
        errors.push(
          `${message[0].toUpperCase()}${message.slice(1)} (${where}).`
        );
    }
  });
}

function readSections(lines) {
  const titles = [];
  const sections = [];
  const preamble = [];
  for (const line of lines) {
    const match = HEADING.exec(line);
    if (match && match[1].length === 1) titles.push(match[2]);
    if (match && match[1].length === 2) {
      sections.push({ heading: match[2], words: 0 });
    } else if (sections.length > 0) {
      sections[sections.length - 1].words += countWords(line);
    } else if (!match) {
      preamble.push(line.trim());
    }
  }
  return { titles, sections, preamble };
}

function checkHeadings(sections, headings, errors) {
  const actual = sections.map(({ heading }) => heading.trim().toLowerCase());
  const expected = headings.map((heading) => heading.toLowerCase());
  for (const heading of headings) {
    if (!actual.includes(heading.toLowerCase()))
      errors.push(`Missing heading "${heading}".`);
  }
  for (const { heading } of sections) {
    if (!expected.includes(heading.trim().toLowerCase()))
      errors.push(`Unexpected heading "${heading}".`);
  }
  const present = actual.filter((heading) => expected.includes(heading));
  const wanted = expected.filter((heading) => present.includes(heading));
  if (
    present.join('\n') !== wanted.join('\n') ||
    new Set(present).size !== present.length
  ) {
    errors.push(
      `Headings must appear once each, in this order: ${headings.join(' / ')}.`
    );
  }
  for (const { heading, words } of sections) {
    if (words === 0) errors.push(`Section "${heading}" is empty.`);
  }
}

function readMetadata(preamble, taskId, errors) {
  const taskLine = preamble.map((line) => TASK_LINE.exec(line)).find(Boolean);
  if (!taskLine || taskLine[1] !== taskId) {
    errors.push(
      `Task line must read "Task: ${taskId}" to match the file name.`
    );
  }
  const signoffLine = preamble
    .map((line) => SIGNOFF_LINE.exec(line))
    .find(Boolean);
  const value = signoffLine?.[1].toLowerCase();
  if (value !== 'required' && value !== 'not required') {
    errors.push(
      'Owner sign-off line must read "Owner sign-off: required" or "Owner sign-off: not required".'
    );
    return true;
  }
  return value === 'required';
}

export function validateSummary(text, { taskId, headings, maxWords }) {
  const errors = [];
  const visible = stripComments(String(text).replace(/\r\n?/g, '\n'), errors);
  const lines = visible.split('\n');
  checkPlainEnglish(lines, errors);
  const { titles, sections, preamble } = readSections(lines);
  if (titles.length !== 1 || countWords(titles[0] ?? '') === 0) {
    errors.push('Needs exactly one "# " title line.');
  }
  checkHeadings(sections, headings, errors);
  const ownerSignoffRequired = readMetadata(preamble, taskId, errors);
  const wordCount = countWords(visible);
  if (wordCount > maxWords)
    errors.push(`Has ${wordCount} words, over the ${maxWords}-word limit.`);
  return { errors, ownerSignoffRequired, wordCount };
}

export function findChangedSummaries(files, summaryConfig) {
  const prefix = `${summaryConfig.directory}/`;
  const summaries = [];
  const errors = [];
  for (const file of files) {
    if (file.status === 'removed' || !file.filename.startsWith(prefix))
      continue;
    const name = file.filename.slice(prefix.length);
    if (summaryConfig.ignoredFiles.includes(name)) continue;
    const taskId = name.endsWith('.md') ? name.slice(0, -3) : '';
    if (name.includes('/') || !TASK_ID.test(taskId)) {
      errors.push(
        `Summary file ${file.filename} must be named ${prefix}<task-id>.md.`
      );
      continue;
    }
    summaries.push({ path: file.filename, taskId });
  }
  return { summaries, errors };
}

const PLACEHOLDER = /^(?:<.*>|tbd|todo|n\/?a|none|unknown|later|\?+|-+)$/i;

function cleanStatement(value) {
  return value
    .replace(/[`*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;,]+$/, '')
    .trim();
}

export function findEvidenceAndDarkUntil(body, evidenceDirectory) {
  const text = String(body ?? '').replace(/<!--[\s\S]*?-->/g, '');
  const escaped = evidenceDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const evidencePattern = new RegExp(
    `${escaped}/[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*\\.(?:md|json)`,
    'g'
  );
  const evidencePaths = [];
  for (const [path] of text.matchAll(evidencePattern)) {
    if (!path.split('/').includes('..') && !evidencePaths.includes(path))
      evidencePaths.push(path);
  }
  let darkUntil = null;
  for (const line of text.split(/\r?\n/)) {
    const match = /\bdark until\b[*_`]*\s*:?[*_`]*\s*(.*)$/i.exec(line);
    const value = match ? cleanStatement(match[1]) : '';
    if (value.length >= 3 && !PLACEHOLDER.test(value)) {
      darkUntil = value;
      break;
    }
  }
  return { evidencePaths, darkUntil };
}
