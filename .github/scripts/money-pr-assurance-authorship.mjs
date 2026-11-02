// Shared rules for who wrote a reviewer comment or review, when, which commit
// it names, and whether it was withdrawn. GitHub lets anyone with write
// access edit, hide or dismiss other people's comments and reviews, so an
// item last edited by someone other than its author is not theirs.

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

function latest(...times) {
  return times.reduce(
    (newest, time) => (time && time > newest ? time : newest),
    ''
  );
}

export function createdAt(item) {
  return item.createdAt || item.submittedAt || '';
}

// When the item's text was last written: its creation or its last body
// edit (GitHub's lastEditedAt; the REST update time when that is unread).
export function writtenAt(item) {
  const edited = item.editedAt === undefined ? item.updatedAt : item.editedAt;
  return latest(createdAt(item), edited ?? '');
}

// The last time anything touched the item, for rules that must not let a
// later change slip past.
export function touchedAt(item) {
  return latest(createdAt(item), item.updatedAt ?? '', item.editedAt ?? '');
}

export function byNewest(left, right) {
  return right.time.localeCompare(left.time) || right.id - left.id;
}

// A dismissed review or a hidden comment has been taken back.
export function withdrawn(item) {
  return item.state === 'DISMISSED' || item.minimized === true;
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

// The newest request a requester login made, unedited by anyone else and not
// hidden, asking this reviewer to follow the money-rules prompt for the
// exact full head commit. Its last touch, edits included, is the time a
// verdict must follow; null when there is no such request.
export function latestRequest(family, { comments, head, promptPath }) {
  const phrase = family.requestPhrase.toLowerCase();
  const names = new RegExp(`(?:^|[^0-9a-f])${head}(?:$|[^0-9a-f])`, 'i');
  const times = comments
    .filter(
      (item) =>
        writtenBy(item, family.requestedBy) &&
        item.userType === 'User' &&
        !withdrawn(item) &&
        item.body.toLowerCase().includes(phrase) &&
        item.body.includes(promptPath) &&
        names.test(item.body)
    )
    .map(touchedAt);
  return times.length > 0 ? { time: latest(...times) } : null;
}

export function requestHint(family, { head, promptPath }) {
  return `the owner comments "${family.requestPhrase} Follow the main branch's ${promptPath} for commit ${head}"`;
}
