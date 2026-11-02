// Shared rules for who wrote a reviewer comment or review and which commit it
// names. GitHub lets anyone with write access edit other people's comments,
// so an item last edited by someone other than its author is not theirs.

const MIN_SHA_PREFIX = 7;

export function shaMatchesHead(candidate, head) {
  const value = String(candidate ?? '').toLowerCase();
  return (
    /^[0-9a-f]+$/.test(value) &&
    value.length >= MIN_SHA_PREFIX &&
    head.toLowerCase().startsWith(value)
  );
}

export function short(sha) {
  return String(sha).slice(0, 7);
}

export function byNewest(left, right) {
  return right.time.localeCompare(left.time) || right.id - left.id;
}

// `editor` is the login that last edited the item, null when never edited;
// any other value, including an unknown editor, withdraws the authorship.
export function writtenBy(item, logins) {
  return (
    logins.includes(item.login) &&
    (item.editor === null || item.editor === item.login)
  );
}

export function authoredBy(item, family) {
  return writtenBy(item, family.logins);
}

// Signals that withdraw or narrow a verdict count whoever edited them last,
// so an edit can never hide one.
export function postedAs(item, family) {
  return family.logins.includes(item.login);
}
