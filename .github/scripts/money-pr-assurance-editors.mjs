// Reads who last edited each trusted comment or review. The REST API keeps
// crediting an edited comment to its original author, and anyone with write
// access can edit other people's comments, bot comments included. Reviews
// treat an item last edited by someone other than its author as not theirs.
const BATCH = 100;

export const UNKNOWN_EDITOR = '(unknown editor)';

const EDITORS_QUERY = `query($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on IssueComment { id lastEditedAt editor { __typename login } }
    ... on PullRequestReview { id lastEditedAt editor { __typename login } }
  }
}`;

// Every login whose comments the assurance can trust.
export function trustedLogins(config) {
  const logins = new Set(config.ownerSignoff.logins);
  for (const family of Object.values(config.reviewers.families)) {
    for (const login of [...family.logins, ...family.requestedBy])
      logins.add(login);
  }
  return [...logins];
}

// GraphQL names a GitHub App by its slug; REST adds "[bot]".
function restLogin(actor) {
  const login = String(actor.login ?? '');
  return actor.__typename === 'Bot' && !login.endsWith('[bot]')
    ? `${login}[bot]`
    : login;
}

function editorOf(node) {
  if (node.editor) return restLogin(node.editor);
  // Edited, but the editor is hidden (for example a deleted account).
  return node.lastEditedAt ? UNKNOWN_EDITOR : null;
}

async function readEditors(client, ids) {
  const editors = new Map();
  for (let start = 0; start < ids.length; start += BATCH) {
    const data = await client.graphql(EDITORS_QUERY, {
      ids: ids.slice(start, start + BATCH),
    });
    for (const node of data.nodes ?? []) {
      if (node?.id) editors.set(node.id, editorOf(node));
    }
  }
  return editors;
}

// Adds `editor` to each item: the REST login that last edited it, null when
// it was never edited, or UNKNOWN_EDITOR when that cannot be established.
export async function attachEditors(client, items, logins) {
  const trusted = (item) => logins.includes(item.login) && item.nodeId;
  const ids = [...new Set(items.filter(trusted).map(({ nodeId }) => nodeId))];
  const editors = ids.length > 0 ? await readEditors(client, ids) : new Map();
  return items.map((item) => ({
    ...item,
    editor:
      trusted(item) && editors.has(item.nodeId)
        ? editors.get(item.nodeId)
        : UNKNOWN_EDITOR,
  }));
}
