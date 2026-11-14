// The reasons the CI test planner (`resolve-ci-test-plan.mjs`) gives with its
// plan. The planner tests pin the exact text, so rewording one is a visible
// change.

export const WEB_SOURCE_REASON =
  'Pull request changes are limited to apps/web source or test files.';
export const WEB_READER_REASON =
  'Pull request changes are limited to apps/web source or test files and files that tests read; the Vitest changed-files provider adds the tests that read them.';
export const WEB_AND_STOREFRONT_REASON =
  'Pull request changes are limited to apps/web and mobile storefront source or test files.';
export const STOREFRONT_REASON =
  'Pull request changes are limited to mobile storefront source or test files.';
export const DELETED_SOURCE_REASON =
  'Deleted or renamed source files keep the full affected test path: unchanged tests may still import them.';
export const DELETED_UNKNOWN_REASON =
  'The list of deleted files could not be read, so CI keeps the full affected test path.';
// Jest's `--changedSince` follows imports only and the changed-files provider
// feeds Vitest alone, so storefront tests that read a data file are not
// selected: next to a storefront change only the full path runs them.
export const STOREFRONT_READER_REASON =
  'Mobile storefront changes next to files that tests read keep the full affected test path: storefront Jest cannot follow fs reads.';
// Only the full path runs the tests of the mobile apps and the packages, and the
// Vitest provider cannot select them: a data file that one of them names keeps it.
export const NON_WEB_READER_REASON =
  'Files that tests outside apps/web read changed, so CI keeps the full affected test path:';
export const READER_SEARCH_FAILED_REASON =
  'The search for tests outside apps/web that read the changed files failed, so CI keeps the full affected test path.';
// Neither Vitest nor Jest can tell which tests read a JSON, CSS or snapshot fixture
// in the source folders; the full path does.
export const SOURCE_DATA_REASON =
  'A fixture in the apps/web or mobile storefront source folders changed next to files outside them, and the targeted run cannot tell which tests read it, so CI keeps the full affected test path.';
