// Path and changed-text classification for the money-path check. Re-exported
// by money-pr-assurance-config.mjs.
import {
  changedText,
  hasMoneyWord,
  isRuntimeCode,
  moneyOperation,
} from './money-pr-assurance-detect.mjs';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// Hyphens and underscores are interchangeable in file names here.
export function normaliseWord(text) {
  return text.toLowerCase().replaceAll('_', '-');
}

// Minimal glob support: "**" spans directories, "*" and "?" stay inside one
// path segment, and every other character is literal.
export function globToRegExp(glob) {
  let pattern = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*' && glob[index + 1] === '*') {
      index += 1;
      if (glob[index + 1] === '/') {
        index += 1;
        pattern += '(?:.*/)?';
      } else {
        pattern += '.*';
      }
    } else if (char === '*') {
      pattern += '[^/]*';
    } else if (char === '?') {
      pattern += '[^/]';
    } else {
      pattern += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${pattern}$`, 'i');
}

const compiledGlobs = new Map();

export function matchesAny(path, globs) {
  return globs.some((glob) => {
    if (!compiledGlobs.has(glob)) compiledGlobs.set(glob, globToRegExp(glob));
    return compiledGlobs.get(glob).test(path);
  });
}

function mentionsKeyword(text, keywords) {
  const normalised = normaliseWord(text);
  return keywords.some((word) => normalised.includes(word));
}

// A money word anywhere in the path, at any depth and ignoring case, or a
// configured money path; documentation and images never count.
function isMoneyName(path, { moneyKeywords, moneyPaths }) {
  if (matchesAny(path, moneyKeywords.outside)) return false;
  return (
    matchesAny(path, moneyPaths) ||
    mentionsKeyword(path, moneyKeywords.keywords)
  );
}

// Database files are named freely, so their changed text is searched too.
// When GitHub returns no diff text (a large or renamed file), the file
// counts as money: what it changes cannot be seen.
export function matchesMoneyContent(
  file,
  { contentPaths, keywords, contentWords }
) {
  const paths = [file.previousFilename, file.filename].filter(isNonEmptyString);
  if (!paths.some((path) => matchesAny(path, contentPaths))) return false;
  return (
    typeof file.patch !== 'string' ||
    mentionsKeyword(file.patch, keywords) ||
    hasMoneyWord(file.patch, contentWords)
  );
}

// Other code is judged by what its changed lines do, whatever it is called:
// the same detection the contract sweep uses. A runtime file whose diff
// GitHub did not return is judged by its path alone.
export function matchesMoneyOperation(file, { contentPaths, contentWords }) {
  if (matchesAny(file.filename, contentPaths)) return false;
  if (!isRuntimeCode(file.filename) || typeof file.patch !== 'string')
    return false;
  return moneyOperation(changedText(file.patch), contentWords) !== null;
}

// Both sides of a rename count, so moving a file out of a money path is
// still reviewed as a money-path change.
export function changedPaths(files) {
  const paths = [];
  for (const file of files) {
    for (const path of [file.previousFilename, file.filename]) {
      if (isNonEmptyString(path) && !paths.includes(path)) paths.push(path);
    }
  }
  return paths;
}

export function classifyChangedFiles(files, config) {
  const paths = changedPaths(files);
  const governanceFiles = paths.filter((path) =>
    matchesAny(path, config.governancePaths)
  );
  const byContent = new Set(
    changedPaths(
      files.filter(
        (file) =>
          matchesMoneyContent(file, config.moneyKeywords) ||
          matchesMoneyOperation(file, config.moneyKeywords)
      )
    )
  );
  const moneyFiles = paths.filter(
    (path) =>
      governanceFiles.includes(path) ||
      byContent.has(path) ||
      isMoneyName(path, config)
  );
  return { isMoneyPath: moneyFiles.length > 0, moneyFiles, governanceFiles };
}
