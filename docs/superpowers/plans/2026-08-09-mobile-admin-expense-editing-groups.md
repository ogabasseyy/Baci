# Mobile Admin Expense Editing and Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Let authorized mobile-admin users edit recorded expenses, organize them into optional named merchant groups, and filter the expense list with accurate totals.

**Architecture:** Extend expenses, add a merchant-scoped expense_groups table, and provision a private expense-receipts bucket in one append-only migration. Supabase RLS remains authoritative across rows and objects, branch/group ownership is enforced in PostgreSQL, and expenses.updated_at is the optimistic-concurrency token. The app extracts reusable form state, fields, private-receipt handling, and persistence so create and edit use one validated contract.

**Tech Stack:** Expo 57, React Native 0.86, React 19, TypeScript 6, Expo Router, TanStack Query, Supabase/PostgreSQL with RLS, Zod 4, Vitest, React Testing Library, Biome.

**Revision:** 3 — rereviewed against `origin/main@034e0047fcea7ebf7e01cb9cd5d7eeb88189c762` on 2026-08-09. This revision corrects the SQL-test/CLI workflow, matches permission precedence exactly, adds permission-aware mobile UI, prevents merchant identity changes, moves new receipts out of the public media bucket, preserves legacy receipt compatibility, adds explicit grants and database constraints, and removes an unapproved ban on future expense dates.

## Global Constraints

- Execute from a clean isolated worktree created from the latest origin/main; do not modify or stash the dirty root.
- Add supabase/migrations/20260809120000_expense_editing_and_groups.sql. Never edit an existing migration.
- Do not modify proxy.ts, .env files, or business-types.ts.
- Use the authenticated Supabase mobile client only; never introduce a service-role/admin client.
- RLS is authoritative. UI visibility may mirror permissions but cannot replace database enforcement.
- Mobile routes must query `get_user_access()` and hide or disable actions the caller cannot perform; wildcard and `full_access.all` grants must match `check_staff_permission` semantics.
- New receipts are private financial records. Store them only in the private expense-receipts bucket and mint short-lived signed URLs for display; never persist a signed URL.
- Keep expense deletion out of v1. Only expense groups can be archived.
- Do not add React.memo, useCallback, or useMemo.
- Keep every new or touched source file under 300 lines and give every runtime source a colocated test.
- Select explicit Supabase columns; never use select-star.
- Validate every Supabase row and every form write through Zod.
- Archived groups remain visible on historical expenses but cannot be selected for new assignments.
- Run focused tests per task, then full repository gates and CodeRabbit.

---

## Target File Map

Database:

- Create supabase/migrations/20260809120000_expense_editing_and_groups.sql.
- Create supabase/tests/expense_editing_and_groups.sql using the repository's transaction-wrapped `DO`/exception contract style.
- Regenerate apps/web/src/types/supabase.ts.

Domain and persistence:

- Extend apps/mobile-admin/schemas/expense.ts and its test.
- Extract schemas/expense-detail.ts and schemas/expense-branch-label.ts with tests from the touched multi-schema file.
- Add schemas/expense-group.ts and its test.
- Add schemas/expense-form.ts and its test.
- Add lib/expense-date.ts, lib/expense-receipt.ts, and tests.
- Add hooks/useExpenseFormState.ts, hooks/useSaveExpense.ts, and tests.
- Add hooks/useExpenseReceiptUrl.ts and its test.
- Add schemas/expense-access.ts, hooks/useExpenseAccess.ts, and tests.

Groups:

- Add hooks/useExpenseGroups.ts and test.
- Add ExpenseGroupSelector.tsx and test.
- Add ExpenseGroupManagerSheet.tsx and test.

Form:

- Reduce ExpenseFormFields.tsx to a composition shell.
- Add ExpenseCoreFields.tsx, ExpenseMetadataFields.tsx, ExpenseReceiptField.tsx, and tests.
- Extend expense-form.styles.ts.

Routes and list:

- Modify app/(admin)/(tabs)/menu.tsx and its colocated test so expenses are visible only with expenses.view.
- Refactor expenses/new.tsx and its test.
- Add expenses/[id]/edit.tsx and its test.
- Extend expenses/[id].tsx, ExpenseDetails.tsx, and tests.
- Add expense-filters.ts, ExpenseFilterBar.tsx, ExpenseFiltersSheet.tsx, and tests.
- Extend expenses-list.utils.ts, styles, expenses/index.tsx, and tests.

---

### Task 1: Add database and authorization contracts

**Files:**

- Create: supabase/migrations/20260809120000_expense_editing_and_groups.sql
- Create: supabase/tests/expense_editing_and_groups.sql
- Modify: apps/web/src/types/supabase.ts

**Interfaces:**

- Consumes: expenses, merchants, branches, check_staff_permission, and update_updated_at_column.
- Produces: expense_groups; expenses.group_id/vendor_name/payment_method/reference/receipt_storage_path/created_by_user_id/updated_by_user_id; private expense-receipts storage; immutable merchant identity; reliable updated_at; explicit grants; expenses.view/create/edit policies.

- [ ] **Step 1: Write the failing SQL contract test**

Use the repository's `BEGIN; DO $$ ... RAISE EXCEPTION ... $$; ROLLBACK;` contract-test style. Assert the table, columns, foreign keys, indexes, constraints, grants, update/actor/immutability triggers, row policies, private storage bucket and object policies, and absence of an expense-row DELETE policy. Include these core catalog checks inside the `DO` block:

~~~sql
IF to_regclass('public.expense_groups') IS NULL THEN
  RAISE EXCEPTION 'expense_groups is missing';
END IF;

IF NOT EXISTS (
  SELECT 1 FROM pg_attribute
  WHERE attrelid = 'public.expenses'::regclass
    AND attname = 'receipt_storage_path'
    AND NOT attisdropped
) THEN
  RAISE EXCEPTION 'expenses.receipt_storage_path is missing';
END IF;

IF NOT EXISTS (
  SELECT 1 FROM pg_trigger
  WHERE tgrelid = 'public.expenses'::regclass
    AND tgname = 'update_expenses_updated_at'
    AND NOT tgisinternal
) THEN
  RAISE EXCEPTION 'expenses updated_at trigger is missing';
END IF;

IF EXISTS (
  SELECT 1 FROM pg_policy
  WHERE polrelid = 'public.expenses'::regclass AND polcmd = 'd'
) THEN
  RAISE EXCEPTION 'expenses must not expose a DELETE policy';
END IF;
~~~

Also prove through rolled-back fixtures that a merchant-B group cannot be attached to merchant A, a newly assigned group must be active, an expense already assigned to an archived group can still update unrelated fields, `merchant_id` cannot be changed on either table, authenticated lacks expense-row DELETE privileges, anon has no expense/group privileges, archived groups remain readable, actor columns come from `auth.uid()`, permission precedence matches `check_staff_permission`, and accountant/admin/manager defaults receive the intended permissions. Assert that `expense-receipts` is private and capped to the approved image MIME types/size, paths outside the caller's merchant folder fail, view permission can read/sign, create or edit permission can upload, edit permission can remove a replaced object, create-only permission can delete only its own unreferenced upload, and unrelated authenticated users plus anon cannot read or mutate objects.

- [ ] **Step 2: Run the SQL test and verify it fails**

Run:

~~~bash
supabase db query --local --file supabase/tests/expense_editing_and_groups.sql --output json
~~~

Expected: non-zero because the group table and columns do not exist. This is intentionally not `supabase test db`: the repository file is a transaction-wrapped SQL contract, while Supabase's test runner expects pgTAP files under `supabase/tests`.

- [ ] **Step 3: Implement the append-only migration**

Use these core shapes:

~~~sql
CREATE TABLE public.expense_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX expense_groups_active_name_unique
  ON public.expense_groups (merchant_id, lower(btrim(name)))
  WHERE archived_at IS NULL;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS group_id uuid
    REFERENCES public.expense_groups(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS vendor_name text,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS receipt_storage_path text,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_amount_positive
    CHECK (amount > 0) NOT VALID,
  ADD CONSTRAINT expenses_vendor_name_length
    CHECK (vendor_name IS NULL OR char_length(btrim(vendor_name)) BETWEEN 1 AND 120),
  ADD CONSTRAINT expenses_payment_method_length
    CHECK (payment_method IS NULL OR char_length(btrim(payment_method)) BETWEEN 1 AND 120),
  ADD CONSTRAINT expenses_reference_length
    CHECK (reference IS NULL OR char_length(btrim(reference)) BETWEEN 1 AND 120),
  ADD CONSTRAINT expenses_description_length
    CHECK (description IS NULL OR char_length(description) <= 500);

CREATE INDEX IF NOT EXISTS idx_expenses_merchant_group_date
  ON public.expenses (merchant_id, group_id, date DESC);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'expense-receipts',
  'expense-receipts',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TRIGGER update_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_expense_groups_updated_at
  BEFORE UPDATE ON public.expense_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
~~~

Before creating triggers, use `DROP TRIGGER IF EXISTS` so local replay is deterministic. Add SECURITY INVOKER trigger functions with empty search paths that: reject a non-null group owned by another merchant; reject assigning an archived group on INSERT or when `group_id` changes while allowing unrelated edits to historical expenses already in an archived group; reject changes to `expenses.merchant_id` and `expense_groups.merchant_id`; stamp expense actor ids from `auth.uid()`; and keep `updated_at` server-owned. Revoke direct EXECUTE on trigger functions from PUBLIC, anon, and authenticated. Retain the branch-matching trigger.

Replace the owner-only all-operations policy with separate SELECT, INSERT, and UPDATE policies. Each allows the merchant owner or check_staff_permission(auth.uid(), merchant_id, 'expenses', action), using view/create/edit respectively. Group SELECT requires expenses.view; group INSERT and UPDATE require expenses.edit. Create no expense-row DELETE policy.

Add authenticated-only `storage.objects` policies for the `expense-receipts` bucket, with the first path segment equal to a merchant the caller owns or is authorized for. SELECT requires expenses.view. INSERT permits expenses.create or expenses.edit so both create and replacement uploads work. DELETE permits expenses.edit, or expenses.create only when the caller owns the object and no expense row references its path; this lets failed creates clean up their own orphan without letting create-only staff remove saved receipts. Use unique object names and no upsert, so no UPDATE policy is needed. These object DELETE rights do not authorize deletion of expense rows.

The baseline grants ALL on expenses to anon and authenticated, so correct table privileges explicitly: revoke ALL on expenses and expense_groups from PUBLIC, anon, and authenticated; grant only SELECT/INSERT/UPDATE on both tables to authenticated; grant ALL to service_role. RLS then decides which authenticated rows each operation may affect, while DELETE is unavailable at the privilege layer as well as the policy layer. Patch role_permissions with jsonb_set so unrelated keys survive: admin, manager, and accountant receive view/create/edit; other defaults remain unchanged. Do not overwrite custom staff overrides.

- [ ] **Step 4: Run SQL and linked compile checks**

~~~bash
expense_compile_file="$(mktemp -t baci-expense-migration.XXXXXX.sql)"
{ printf 'BEGIN;\n'; sed -e '/^[[:space:]]*BEGIN;[[:space:]]*$/d' -e '/^[[:space:]]*COMMIT;[[:space:]]*$/d' supabase/migrations/20260809120000_expense_editing_and_groups.sql; printf '\nROLLBACK;\n'; } > "$expense_compile_file"
supabase db query --linked --file "$expense_compile_file" --output json
supabase migration up --local
supabase db lint --local --level error --fail-on error
supabase db query --local --file supabase/tests/expense_editing_and_groups.sql --output json
rm -f "$expense_compile_file"
~~~

Expected: linked migration parses and rolls back without persisting; local pending migration applies; the transaction-wrapped contract passes and rolls back its fixtures. If local Supabase is not already running in the isolated worktree, run `supabase start` first. Never use `db reset --linked`.

- [ ] **Step 5: Regenerate Supabase types**

After applying the migration to the isolated local Supabase database, run:

~~~bash
supabase gen types typescript --local > apps/web/src/types/supabase.ts
~~~

Verify only the new expense fields and expense_groups types appear. Confirm reference now exists in the generated contract; never hand-edit the generated file.

- [ ] **Step 6: Commit**

~~~bash
git add supabase/migrations/20260809120000_expense_editing_and_groups.sql supabase/tests/expense_editing_and_groups.sql apps/web/src/types/supabase.ts
git commit -m "feat(expenses): add editable expense groups and permissions"
~~~

---

### Task 2: Define validated row and form contracts

**Files:**

- Modify: apps/mobile-admin/schemas/expense.ts
- Modify: apps/mobile-admin/schemas/expense.test.ts
- Create: apps/mobile-admin/schemas/expense-detail.ts
- Create: apps/mobile-admin/schemas/expense-detail.test.ts
- Create: apps/mobile-admin/schemas/expense-branch-label.ts
- Create: apps/mobile-admin/schemas/expense-branch-label.test.ts
- Create: apps/mobile-admin/schemas/expense-group.ts
- Create: apps/mobile-admin/schemas/expense-group.test.ts
- Create: apps/mobile-admin/schemas/expense-form.ts
- Create: apps/mobile-admin/schemas/expense-form.test.ts
- Create: apps/mobile-admin/lib/expense-date.ts
- Create: apps/mobile-admin/lib/expense-date.test.ts

**Interfaces:**

- Produces one primary schema per file—ExpenseSchema, ExpenseDetailSchema, ExpenseBranchLabelSchema, ExpenseGroupSchema, and ExpenseFormSchema—plus ExpenseFormDraft and the single-export expenseDateCodec utility.

- [ ] **Step 1: Write failing tests**

Cover complete rows, nullable metadata, malformed amounts/dates/groups, positive finite amount validation, maximum lengths, and timezone-safe date-only round trips:

~~~ts
it('round-trips a local expense date without shifting the day', () => {
  const localDate = new Date(2026, 7, 9, 23, 30);
  expect(expenseDateCodec.toDateOnly(localDate)).toBe('2026-08-09');
  expect(expenseDateCodec.fromDateOnly('2026-08-09')).toEqual(new Date(2026, 7, 9));
});
~~~

- [ ] **Step 2: Verify tests fail**

~~~bash
pnpm --filter baci-mobile-admin test -- schemas/expense.test.ts schemas/expense-detail.test.ts schemas/expense-branch-label.test.ts schemas/expense-group.test.ts schemas/expense-form.test.ts lib/expense-date.test.ts
~~~

Expected: FAIL on missing exports.

- [ ] **Step 3: Implement schemas**

Extend expense rows with group_id, vendor_name, payment_method, reference, receipt_storage_path, created_by_user_id, updated_by_user_id, and updated_at. Move the existing detail and branch-label contracts out of the touched multi-schema file, keep the group contract in its own schema file, and define:

~~~ts
export const ExpenseGroupSchema = z.object({
  id: z.string().uuid(),
  merchant_id: z.string().uuid(),
  name: z.string().min(1).max(80),
  archived_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
~~~

ExpenseFormSchema contains only user-editable values: a positive finite amount, strict YYYY-MM-DD date, existing category enum, branchId, nullable groupId, and trimmed nullable description/vendorName/paymentMethod/reference. Limit description to 500 and vendor/payment/reference to 120 characters. Receipt URLs and storage paths are persistence state, not form input, and must never be accepted from the editable payload.

- [ ] **Step 4: Implement date helpers**

Build date strings from local year/month/day getters. Parse strict numeric parts and reject impossible dates. Do not parse date-only values through the UTC Date string constructor.

- [ ] **Step 5: Test and commit**

~~~bash
pnpm --filter baci-mobile-admin test -- schemas/expense.test.ts schemas/expense-detail.test.ts schemas/expense-branch-label.test.ts schemas/expense-group.test.ts schemas/expense-form.test.ts lib/expense-date.test.ts
git add apps/mobile-admin/schemas/expense.ts apps/mobile-admin/schemas/expense.test.ts apps/mobile-admin/schemas/expense-detail.ts apps/mobile-admin/schemas/expense-detail.test.ts apps/mobile-admin/schemas/expense-branch-label.ts apps/mobile-admin/schemas/expense-branch-label.test.ts apps/mobile-admin/schemas/expense-group.ts apps/mobile-admin/schemas/expense-group.test.ts apps/mobile-admin/schemas/expense-form.ts apps/mobile-admin/schemas/expense-form.test.ts apps/mobile-admin/lib/expense-date.ts apps/mobile-admin/lib/expense-date.test.ts
git commit -m "feat(expenses): validate editable expense data"
~~~

---

### Task 3: Add permission-aware mobile expense access

**Files:**

- Create: apps/mobile-admin/schemas/expense-access.ts
- Create: apps/mobile-admin/schemas/expense-access.test.ts
- Create: apps/mobile-admin/hooks/useExpenseAccess.ts
- Create: apps/mobile-admin/hooks/useExpenseAccess.test.tsx
- Modify: apps/mobile-admin/app/(admin)/(tabs)/menu.tsx
- Modify: apps/mobile-admin/app/(admin)/(tabs)/menu.test.tsx

**Interfaces:**

~~~ts
export interface ExpenseAccess {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
}

export function useExpenseAccess(): ExpenseAccess & {
  isLoading: boolean;
  error: Error | null;
};
~~~

- [ ] **Step 1: Write failing schema and hook tests**

Mock `supabase.rpc('get_user_access')` and cover owner access, `*.*`, `*.action`, `expenses.*`, `expenses.action`, `expenses.all`, `full_access.all`, malformed JSON, empty rows, and RPC failure. Mirror the database's first-non-null precedence exactly: an earlier broader boolean (including `false`) wins over later keys, so do not implement a generic “any true wins” or “specific false always overrides” rule. Compute `canEdit` as the conjunction of effective view and edit grants because PostgreSQL UPDATE plus returning/select also requires row visibility; test edit-true/view-false as denied. The hook must fail closed while loading or on malformed/error results.

- [ ] **Step 2: Implement access parsing and hook**

Mirror the current database helper's grant semantics: `*.*`, `*.action`, `expenses.*`, `expenses.all`, `expenses.action`, and `full_access.all`. Query under `['user-access', user.id, merchant.id]`, verify the returned merchant_id equals the active merchant, and never infer staff permissions from `merchants.user_id` because staff context contains the owner's id.

- [ ] **Step 3: Add failing menu tests**

Assert Expenses is present for canView, absent for denied/loading/error access, and that no hidden item remains keyboard/screen-reader reachable.

- [ ] **Step 4: Gate the menu item**

Filter the Expenses item from the Business section unless `canView` is true. Route-level read/create/edit gates remain mandatory because deep links bypass the menu.

- [ ] **Step 5: Test and commit**

~~~bash
pnpm --filter baci-mobile-admin test -- schemas/expense-access.test.ts hooks/useExpenseAccess.test.tsx 'app/(admin)/(tabs)/menu.test.tsx'
git add apps/mobile-admin/schemas/expense-access.ts apps/mobile-admin/schemas/expense-access.test.ts apps/mobile-admin/hooks/useExpenseAccess.ts apps/mobile-admin/hooks/useExpenseAccess.test.tsx 'apps/mobile-admin/app/(admin)/(tabs)/menu.tsx' 'apps/mobile-admin/app/(admin)/(tabs)/menu.test.tsx'
git commit -m "feat(expenses): enforce mobile expense permissions"
~~~

---

### Task 4: Add receipt persistence, reusable form state, and mutations

**Files:**

- Create: apps/mobile-admin/lib/expense-receipt.ts and test
- Create: apps/mobile-admin/hooks/useExpenseReceiptUrl.ts and test
- Create: apps/mobile-admin/hooks/useExpenseFormState.ts and test
- Create: apps/mobile-admin/hooks/useSaveExpense.ts and test

**Interfaces:**

~~~ts
export const expenseReceiptStorage: {
  upload: (
    merchantId: string,
    localUri: string
  ) => Promise<{ storagePath: string }>;
  removeOwned: (merchantId: string, storagePath: string) => Promise<void>;
};

export function useExpenseReceiptUrl(input: {
  merchantId: string;
  receiptStoragePath: string | null;
  legacyReceiptUrl: string | null;
}): { url: string | null; isLoading: boolean; error: Error | null };

export type ExpenseReceiptChange =
  | { kind: 'unchanged' }
  | { kind: 'remove' }
  | { kind: 'replace'; localUri: string };

type SaveExpenseInput =
  | { mode: 'create'; merchantId: string }
  | {
      mode: 'edit';
      merchantId: string;
      expenseId: string;
      expectedUpdatedAt: string;
    };
~~~

- [ ] **Step 1: Write failing receipt tests**

Assert paths use merchant-id/expenses/unique-name in the private `expense-receipts` bucket, uploads use unique names with `upsert: false`, remote URLs are not uploaded, only a stored path under the exact current-merchant prefix can be removed, legacy rows with null receipt_storage_path are never deleted by URL guessing, failed database writes clean up only the new unreferenced object, and receipt contents/URLs are not logged. Cover signed-URL success, expiry-driven refresh through query invalidation, private-path errors, and safe fallback to a validated legacy HTTPS URL.

- [ ] **Step 2: Implement receipt helpers**

Upload to `expense-receipts` and return only the storage path. For new uploads persist `receipt_storage_path` and set `receipt_url` to null; never persist the short-lived signed URL. `useExpenseReceiptUrl` verifies the path starts with the exact active merchant id, mints a five-minute signed read URL, and uses a four-minute query stale time so previews refresh before expiry. It uses the existing validated HTTPS `receipt_url` only as a legacy fallback. After a successful expense update, cleanup failure is non-fatal and may log only the safe owned storage path. Never derive a deletion target from a public or signed URL.

- [ ] **Step 3: Write failing form-state tests**

Cover create defaults, edit preload, field changes, dirty calculation, reset, local receipt selection, and reversible removal retaining originalLegacyReceiptUrl and originalReceiptStoragePath. Receipt state must produce the explicit unchanged/remove/replace union and cannot be mutated through generic form fields.

- [ ] **Step 4: Implement useExpenseFormState**

Expose values, originalLegacyReceiptUrl, originalReceiptStoragePath, receiptChange, preview state, isDirty, typed setField, setLocalReceipt, removeReceipt, and reset. Keep upload, signing, deletion, and database persistence outside this hook.

- [ ] **Step 5: Write failing mutation tests**

Cover create/update success, Zod rejection before Supabase, rejection of caller-supplied receipt fields, branch/group metadata, receipt replace/remove/unchanged, new-upload cleanup on failure, cache invalidation, and stale updated_at conflict.

- [ ] **Step 6: Implement useSaveExpense**

Construct the database receipt columns only from the original persisted receipt state and the trusted upload result—never from form values. For edit, update only mutable fields and scope by id, merchant_id, and expected updated_at, then select id and updated_at. No returned row throws ExpenseConflictError with: “This expense changed elsewhere. Reload it before saving again.” Remove the old private receipt only after the database update succeeds; never delete a legacy URL-only receipt.

- [ ] **Step 7: Test and commit**

~~~bash
pnpm --filter baci-mobile-admin test -- lib/expense-receipt.test.ts hooks/useExpenseReceiptUrl.test.tsx hooks/useExpenseFormState.test.tsx hooks/useSaveExpense.test.tsx
git add apps/mobile-admin/lib/expense-receipt.ts apps/mobile-admin/lib/expense-receipt.test.ts apps/mobile-admin/hooks/useExpenseReceiptUrl.ts apps/mobile-admin/hooks/useExpenseReceiptUrl.test.tsx apps/mobile-admin/hooks/useExpenseFormState.ts apps/mobile-admin/hooks/useExpenseFormState.test.tsx apps/mobile-admin/hooks/useSaveExpense.ts apps/mobile-admin/hooks/useSaveExpense.test.tsx
git commit -m "feat(expenses): share conflict-safe expense persistence"
~~~

---

### Task 5: Add merchant expense-group management

**Files:**

- Create: apps/mobile-admin/hooks/useExpenseGroups.ts and test
- Create: apps/mobile-admin/components/expenses/ExpenseGroupSelector.tsx and test
- Create: apps/mobile-admin/components/expenses/ExpenseGroupManagerSheet.tsx and test
- Modify: apps/mobile-admin/components/expenses/expense-form.styles.ts

**Interfaces:**

- Consumes: `useExpenseAccess().canEdit`; RLS remains the write boundary.

~~~ts
export interface UseExpenseGroupsResult {
  activeGroups: ExpenseGroup[];
  allGroups: ExpenseGroup[];
  isLoading: boolean;
  createGroup: (name: string) => Promise<ExpenseGroup>;
  renameGroup: (id: string, name: string) => Promise<void>;
  archiveGroup: (id: string) => Promise<void>;
}
~~~

- [ ] **Step 1: Write failing hook tests**

Assert explicit columns, merchant scoping, active-only and historical queries, trimmed names, create/rename/archive, duplicate-name copy, and query invalidation.

- [ ] **Step 2: Implement useExpenseGroups**

Every read/write includes merchant_id. Parse results with ExpenseGroupSchema. Active queries require archived_at IS NULL; all-group queries retain archived rows for details.

- [ ] **Step 3: Write failing UI tests**

Cover “No group”, active options, selection state, Manage, create, rename, archive confirmation, duplicate errors, busy states, denied `canEdit`, and accessibility. The manager action and mutation controls must not render without edit permission.

- [ ] **Step 4: Implement selector and manager**

Use AppSheetModal and theme tokens. Archive confirmation says: “Existing expenses keep this group. It will no longer appear when adding or editing expenses.” Pass `canEdit` explicitly; do not make the component infer permission from role names.

- [ ] **Step 5: Test and commit**

~~~bash
pnpm --filter baci-mobile-admin test -- hooks/useExpenseGroups.test.tsx components/expenses/ExpenseGroupSelector.test.tsx components/expenses/ExpenseGroupManagerSheet.test.tsx
git add apps/mobile-admin/hooks/useExpenseGroups.ts apps/mobile-admin/hooks/useExpenseGroups.test.tsx apps/mobile-admin/components/expenses/ExpenseGroupSelector.tsx apps/mobile-admin/components/expenses/ExpenseGroupSelector.test.tsx apps/mobile-admin/components/expenses/ExpenseGroupManagerSheet.tsx apps/mobile-admin/components/expenses/ExpenseGroupManagerSheet.test.tsx apps/mobile-admin/components/expenses/expense-form.styles.ts
git commit -m "feat(expenses): manage named expense groups"
~~~

---

### Task 6: Extract the expanded reusable form

**Files:**

- Modify: ExpenseFormFields.tsx, its test, and expense-form.styles.ts
- Create: ExpenseCoreFields.tsx and test
- Create: ExpenseMetadataFields.tsx and test
- Create: ExpenseReceiptField.tsx and test

All paths are under apps/mobile-admin/components/expenses.

- [ ] **Step 1: Write failing field tests**

Cover amount normalization, date picker, category, description, vendor, payment method, reference, group, add/replace/remove receipt, disabled state, and role-based accessibility queries.

- [ ] **Step 2: Implement ExpenseCoreFields**

Render amount, date, category, and description. Reuse AppDatePickerField, store YYYY-MM-DD, and display a localized date. Do not impose a future-date ban in v1: that accounting policy was not part of the approved design, and planned/advance expenses may legitimately use a future date.

- [ ] **Step 3: Implement ExpenseMetadataFields**

Render optional Vendor or payee, Payment method, and Reference fields with 120-character limits. Keep payment method free text in v1; Zod trims it.

- [ ] **Step 4: Implement ExpenseReceiptField**

Render existing remote or new local preview plus explicit Add/Replace and Remove actions. Removing remains reversible until Save.

- [ ] **Step 5: Reduce ExpenseFormFields to composition**

Compose core, metadata, receipt, branch, and group controls. It owns no queries or mutations and remains under 150 lines.

- [ ] **Step 6: Test size and commit**

~~~bash
pnpm --filter baci-mobile-admin test -- components/expenses/ExpenseCoreFields.test.tsx components/expenses/ExpenseMetadataFields.test.tsx components/expenses/ExpenseReceiptField.test.tsx components/expenses/ExpenseFormFields.test.tsx
pnpm --filter baci-mobile-admin check:module-size
git add apps/mobile-admin/components/expenses/ExpenseFormFields.tsx apps/mobile-admin/components/expenses/ExpenseFormFields.test.tsx apps/mobile-admin/components/expenses/ExpenseCoreFields.tsx apps/mobile-admin/components/expenses/ExpenseCoreFields.test.tsx apps/mobile-admin/components/expenses/ExpenseMetadataFields.tsx apps/mobile-admin/components/expenses/ExpenseMetadataFields.test.tsx apps/mobile-admin/components/expenses/ExpenseReceiptField.tsx apps/mobile-admin/components/expenses/ExpenseReceiptField.test.tsx apps/mobile-admin/components/expenses/expense-form.styles.ts
git commit -m "refactor(expenses): share editable expense fields"
~~~

---

### Task 7: Wire create, edit, and details

**Files:**

- Modify: apps/mobile-admin/app/(admin)/expenses/new.tsx and test
- Create: apps/mobile-admin/app/(admin)/expenses/[id]/edit.tsx and test
- Modify: apps/mobile-admin/app/(admin)/expenses/[id].tsx and test
- Modify: ExpenseDetails.tsx, its test, and types.ts

**Interfaces:**

- Consumes: `useExpenseAccess` from Task 3. List/detail require `canView`, new requires `canCreate`, and edit/group management require `canEdit`.

- [ ] **Step 1: Update create tests first**

Assert all fields reach useSaveExpense, today defaults, optional group, authoritative branch scope, invalid input does not mutate, dirty Close confirms, success navigates, and denied/loading/error `canCreate` never renders the form or sends a query/write.

- [ ] **Step 2: Refactor create**

Remove inline upload and field-level state. Compose shared form state, groups, mutation, fields, category/group sheets, and existing image picker. Render a permission-denied state unless `canCreate` is true.

- [ ] **Step 3: Write failing edit tests**

Cover loading/error/not-found, preload, archived historical group, changed payload, unchanged Save disabled, dirty-close confirmation, conflict Reload/Cancel, private signed receipt preview, legacy receipt fallback, receipt replace/remove, success, and fail-closed `canEdit` behavior for deep links.

- [ ] **Step 4: Implement edit route**

Select exactly:

~~~text
id, merchant_id, amount, category, description, date, receipt_url,
receipt_storage_path, branch_id, group_id, vendor_name, payment_method,
reference, created_by_user_id, updated_by_user_id, updated_at
~~~

Wait for access resolution and require `canEdit` before querying. Scope by expense id, merchant id, and active branch scope. Parse, preload, and save with expectedUpdatedAt. Reload invalidates detail and resets from the new row.

- [ ] **Step 5: Repair and extend details**

Require `canView` before querying. Add all metadata, actor ids, receipt_storage_path, and updated_at to the detail selection, fetch assigned group from allGroups, resolve private receipts through `useExpenseReceiptUrl`, and show the Edit header action only when `canEdit`. Display Vendor, Payment method, Reference, and Group with None/Ungrouped fallbacks.

- [ ] **Step 6: Test and commit**

~~~bash
pnpm --filter baci-mobile-admin test -- 'app/(admin)/expenses/new.test.tsx' 'app/(admin)/expenses/[id].test.tsx' 'app/(admin)/expenses/[id]/edit.test.tsx' components/expenses/ExpenseDetails.test.tsx
git add 'apps/mobile-admin/app/(admin)/expenses/new.tsx' 'apps/mobile-admin/app/(admin)/expenses/new.test.tsx' 'apps/mobile-admin/app/(admin)/expenses/[id]/edit.tsx' 'apps/mobile-admin/app/(admin)/expenses/[id]/edit.test.tsx' 'apps/mobile-admin/app/(admin)/expenses/[id].tsx' 'apps/mobile-admin/app/(admin)/expenses/[id].test.tsx' apps/mobile-admin/components/expenses/ExpenseDetails.tsx apps/mobile-admin/components/expenses/ExpenseDetails.test.tsx apps/mobile-admin/components/expenses/types.ts
git commit -m "feat(expenses): edit expenses in mobile admin"
~~~

---

### Task 8: Add filters and month totals

**Files:**

- Create: expense-filters.ts and test
- Create: ExpenseFilterBar.tsx and test
- Create: ExpenseFiltersSheet.tsx and test
- Modify: expenses-list.utils.ts/test, styles/test
- Modify: apps/mobile-admin/app/(admin)/expenses/index.tsx and test

Component paths are under apps/mobile-admin/components/expenses.

**Interfaces:**

~~~ts
export interface ExpenseFilters {
  datePreset: 'all' | 'this_month' | 'last_month' | 'custom';
  startDate: string | null;
  endDate: string | null;
  category: ExpenseCategory | 'all';
  branchId: string | 'all';
  groupId: string | 'all' | 'ungrouped';
}
~~~

- [ ] **Step 1: Write failing pure filter tests**

Test Lagos-local month date strings, normalized custom ranges, active-filter count, reset defaults, serializable query keys, ungrouped IS NULL, and UUID group equality.

- [ ] **Step 2: Implement normalization**

Return date-only/string values, never Date objects. Branch scope overrides a conflicting filter.

- [ ] **Step 3: Write failing filter UI tests**

Cover presets, custom range, category, branch, group, Ungrouped, Apply, Reset, active-count badge, and accessibility.

- [ ] **Step 4: Implement filter bar and sheet**

Reuse AppSheetModal and AppDatePickerField. When branch scope is specific, display it as locked context.

- [ ] **Step 5: Extend grouping tests and utility**

Month header rows gain total and count:

~~~ts
{
  type: 'header';
  key: string;
  monthKey: string;
  title: string;
  total: number;
  count: number;
}
~~~

Retain newest-first sorting and Unknown Month placement. Render localized total and singular/plural count in headers.

- [ ] **Step 6: Update list integration tests**

Assert normalized filters appear in query keys, query builder receives date/category/branch/group constraints, the selection includes new columns, active filters show “Filtered total”, reset restores “Total this Month”, no-match copy differs from no-expenses copy, denied `canView` never queries, and create controls appear only with `canCreate`.

- [ ] **Step 7: Implement server-side filters and matching totals**

Wait for `useExpenseAccess` and require `canView` before querying. Apply gte/lte on date, eq on category/branch/group, and is-null for ungrouped before awaiting Supabase. Calculate the summary from exactly the returned rows so the total cannot disagree with the visible list. Hide both Add buttons unless `canCreate` is true.

- [ ] **Step 8: Test and commit**

~~~bash
pnpm --filter baci-mobile-admin test -- components/expenses/expense-filters.test.ts components/expenses/ExpenseFilterBar.test.tsx components/expenses/ExpenseFiltersSheet.test.tsx components/expenses/expenses-list.utils.test.ts components/expenses/expenses-list.styles.test.ts 'app/(admin)/expenses/index.test.tsx'
git add apps/mobile-admin/components/expenses/expense-filters.ts apps/mobile-admin/components/expenses/expense-filters.test.ts apps/mobile-admin/components/expenses/ExpenseFilterBar.tsx apps/mobile-admin/components/expenses/ExpenseFilterBar.test.tsx apps/mobile-admin/components/expenses/ExpenseFiltersSheet.tsx apps/mobile-admin/components/expenses/ExpenseFiltersSheet.test.tsx apps/mobile-admin/components/expenses/expenses-list.utils.ts apps/mobile-admin/components/expenses/expenses-list.utils.test.ts apps/mobile-admin/components/expenses/expenses-list.styles.ts apps/mobile-admin/components/expenses/expenses-list.styles.test.ts 'apps/mobile-admin/app/(admin)/expenses/index.tsx' 'apps/mobile-admin/app/(admin)/expenses/index.test.tsx'
git commit -m "feat(expenses): filter spending with grouped totals"
~~~

---

### Task 9: Verify the complete workflow

- [ ] **Step 1: Run focused tests**

~~~bash
pnpm --filter baci-mobile-admin test -- schemas/expense.test.ts schemas/expense-detail.test.ts schemas/expense-branch-label.test.ts schemas/expense-group.test.ts schemas/expense-form.test.ts schemas/expense-access.test.ts lib/expense-date.test.ts lib/expense-receipt.test.ts hooks/useExpenseAccess.test.tsx hooks/useExpenseReceiptUrl.test.tsx hooks/useExpenseFormState.test.tsx hooks/useSaveExpense.test.tsx hooks/useExpenseGroups.test.tsx components/expenses 'app/(admin)/expenses' 'app/(admin)/(tabs)/menu.test.tsx'
supabase db query --local --file supabase/tests/expense_editing_and_groups.sql --output json
~~~

Expected: all focused tests PASS.

- [ ] **Step 2: Run mandatory gates**

~~~bash
pnpm turbo lint
pnpm turbo typecheck
pnpm turbo test
pnpm --filter baci-mobile-admin check:module-size
~~~

Expected: zero Biome/type errors, all tests PASS, no touched file over 300 lines. Report unrelated existing failures; never weaken gates.

- [ ] **Step 3: Run CodeRabbit**

~~~bash
coderabbit review --agent -t uncommitted
~~~

Fix valid critical/high findings and rerun affected tests until none remain.

- [ ] **Step 4: Perform Android emulator smoke QA**

Use only the repository flow:

~~~bash
pnpm --filter baci-mobile-admin android:emulator
cd apps/mobile-admin/android && ./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --console=plain
cd ../../.. && pnpm --filter baci-mobile-admin android:install
pnpm --filter baci-mobile-admin android:metro
pnpm --filter baci-mobile-admin android:launch
~~~

Verify create ungrouped/grouped, create/rename/archive group, edit every field, replace/remove receipt, stale conflict, archived historical label, each filter, totals, branch scope, dark/light mode, and accessibility labels.

- [ ] **Step 5: Record exact head**

~~~bash
git status --short
git log -1 --oneline
~~~

The worktree must contain only intended expense files. Do not claim deployment, release, or production migration from local verification.

---

## Completion Criteria

- Owners and explicitly permitted staff can view/create/edit; unauthorized staff fail closed in both deep-linked UI and RLS.
- Detail no longer queries a nonexistent reference contract.
- Create and edit share one validated form and private receipt path; legacy public receipt URLs remain readable but are never guessed for deletion.
- Concurrent edits cannot silently overwrite newer values.
- Groups are merchant-scoped, optional, renameable, and archivable without breaking history.
- Date/category/branch/group filters are server-side and totals match visible rows.
- Expenses remain undeletable in v1.
- Focused tests, SQL contracts, full gates, CodeRabbit, and Android smoke QA complete.

## Plan Self-Review

- Scope coverage: Tasks 1–8 cover editing, named groups, filters, totals, staff authorization, receipt replacement/removal, and the reference mismatch; Task 9 covers verification.
- Boundary check: expense deletion, full old/new audit history, approvals, recurring expenses, OCR, bank feeds, reimbursement, pagination, and budget enforcement remain outside v1.
- Type consistency: database snake_case rows are parsed into the schemas in Task 2; form values use camelCase; useSaveExpense is the only mapping/write boundary.
- Safety check: every write is merchant-scoped, RLS-enforced, Zod-validated, branch/group-integrity checked, actor-stamped, merchant-immutable, private-receipt-path owned, and update-conflict guarded; signed receipt URLs are ephemeral and never persisted.
- Placeholder check: every planned file, interface, command, error path, and acceptance check is specified; the implementation contains no unnamed follow-up step.
