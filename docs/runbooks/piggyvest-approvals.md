# PiggyVest two-person approvals

Some PiggyVest operations are done by hand by staff: moving Collection wallet
money to the Ogabassey bank account, support payouts, resolving transfers or
checkout payments under review, and similar. Every one of them goes through
the same two-person approval (owner default 8):

- a request records the action, the record it is about and that record's
  version, the amount in kobo and the destination;
- two **different** approvers, neither of them the person who opened the
  request, must approve that exact request within **24 hours**;
- any single rejection closes the request, and the same request (same
  values) can never be asked again;
- an approved request can be used **once**. If the amount, the destination
  or the record's version changes, the approvals no longer count and a new
  request is needed.

Who approved is always the database login that is signed in (`SESSION_USER`).
Nothing in a request or a decision can name an approver.

Status: dark. No feature opens requests yet and no approver login exists.
The SQL is in `supabase/migrations/*_piggyvest_primary_ops_approvals*.sql`
(four parts, versions 20261102041457 to 20261102041500) and is tested by
[`supabase/tests/piggyvest_primary_ops_approvals.sql`](../../supabase/tests/piggyvest_primary_ops_approvals.sql).

## Roles

| Who | What they hold | What they can do |
|---|---|---|
| Each human approver | their own LOGIN, granted only `piggyvest_primary_approver` | list open requests; approve or reject one |
| Ops / support commands and workers (later PRs) | their own dedicated LOGIN and role | open a request; carry out an action after two approvals |
| Owner (`postgres`) | migration owner | create and remove approver logins |

An approver login counts only while it:

- can log in and has no elevated attribute (superuser, create role, create
  database, replication, bypass RLS);
- is a direct member of `piggyvest_primary_approver`, without ADMIN OPTION;
- is a member of **no other role**: no engine, ops, support, service or API
  role.

This is checked when the decision is made **and again** when the action is
carried out, so giving an approver login any other role voids its approvals.

## One-time setup: add an approver (owner only)

Do this yourself, in your own terminal, with `psql` connected as the owner.
Never in a migration, a `.env` file, a CI job, a chat message or an AI agent
session. Set passwords only with psql's `\password` (step 2), never by typing
one into SQL or the Supabase SQL editor, which keeps query history.

1. Create the login without a password. Pick a personal name such as
   `pv_approver_amaka`; one login per person, never shared.

   ```sql
   CREATE ROLE pv_approver_amaka LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
     NOREPLICATION NOBYPASSRLS INHERIT CONNECTION LIMIT 2;
   GRANT piggyvest_primary_approver TO pv_approver_amaka;
   ```

2. Set a first password with psql's hidden prompt. `\password` hashes it on
   your machine, so the plain password never reaches the server or its logs.

   ```text
   \password pv_approver_amaka
   ```

   Give it to the approver in person. They change it at first use (below).

3. Check the login qualifies (expect `t`):

   ```sql
   SELECT piggyvest_primary.ops_login_is_approver('pv_approver_amaka'::regrole);
   ```

Repeat for the second approver. Two approvers are the minimum; a third
covers holidays. The person who opens a request can never approve it, so an
ops person who also approves needs someone else to open their requests.

## First sign-in: change your password (approver)

```text
psql "host=<db host> port=5432 dbname=postgres user=pv_approver_amaka sslmode=verify-full sslrootcert=<ca file>"
\password
```

`\password` with no name changes your own password at a hidden prompt.

## Approving or rejecting (approver)

You need a checkout of this repository with dependencies installed and the
database server's CA certificate saved as a file (Supabase dashboard,
Database settings, SSL configuration). Run from `apps/web`:

```sh
# 1. See what is waiting for you (open, not expired, not opened by you).
../../node_modules/.bin/tsx tools/piggyvest-ops/approve.ts \
  --host <db host> --user pv_approver_amaka --ca <ca file>

# 2. Check one request. This is a dry run: nothing is recorded.
../../node_modules/.bin/tsx tools/piggyvest-ops/approve.ts \
  --host <db host> --user pv_approver_amaka --ca <ca file> --request <id>

# 3. Record your approval (or add --reject to reject it).
../../node_modules/.bin/tsx tools/piggyvest-ops/approve.ts \
  --host <db host> --user pv_approver_amaka --ca <ca file> --request <id> --commit
```

The tool:

- asks for your password at a hidden prompt, and refuses to run without an
  interactive terminal. It never reads a password from the command line, an
  environment variable or a password file, and refuses any argument that
  looks like one;
- connects with a verified TLS certificate (plain connections are allowed
  only to this machine);
- shows the plain action, the naira amount, the destination (bank code and
  last four characters first, then any label in quotes), the reason, who
  asked, the approvals so far and the expiry;
- makes you retype the naira amount, and stops if it does not match;
- records nothing unless you pass `--commit`.

If the direct database host is not reachable from your network, use the
Supabase session pooler host with the user `pv_approver_amaka.<project ref>`.

Before you approve, check the request against the ticket or message that
asked for it: the amount, the destination and the reason. If anything is
unexpected, reject it.

## Messages and what to do

| Message | Meaning |
|---|---|
| not an approver login | the login is missing the approver role or holds another role; ask the owner |
| you opened this request | someone else must approve it |
| already decided | you have already approved or rejected it |
| closed | it was rejected, used or replaced by a newer request |
| expired | older than 24 hours; ask for a new request |
| changed since it was listed | list again and re-check before deciding |
| did not confirm your decision | the reply was lost; it may or may not be recorded. Run the same command without `--commit` to check before trying again |

## Remove or rotate an approver (owner)

- Remove: `REVOKE piggyvest_primary_approver FROM pv_approver_amaka;` then
  `ALTER ROLE pv_approver_amaka NOLOGIN;`. Their decisions stay on record but
  no longer count for requests that have not been carried out.
- Rotate a password: the approver runs `\password` (above), or the owner runs
  `\password pv_approver_amaka` and hands the new one over in person.

## Never

- Give an approver login any other role, or ADMIN OPTION on the approver
  role.
- Share a login between people, or use `postgres`, the service role or an
  app login to approve.
- Put an approver password in a migration, `.env`, a command line, a script,
  a ticket, a chat or an AI agent's hands.
- Approve a request you cannot match to a real, expected operation.

## For developers adding a money command

Commands that need two approvals call the internal functions from their own
SECURITY DEFINER function (owned by the migration role, granted only to the
command's dedicated role). Neither function is granted to any role.

- `piggyvest_primary.open_ops_request(action, subject_table, subject_id,
  row_version, amount_kobo, destination, context)` returns the request id.
  Calling it again with the same values returns the same open request;
  different values replace it (old approvals never carry over). After 24
  hours the same values open a fresh request. Values that were rejected can
  never be asked again: only a changed row version, amount or destination
  can.
- Open requests only from a session signed in as a dedicated login: one
  person's ops or support login, or one worker's login. The owner
  (`postgres`), a superuser, a login with an elevated attribute, and a shared
  API login (any member of `anon`, `authenticated` or `service_role`, such as
  PostgREST's `authenticator`) are refused with
  `ops_approval_invalid_requester`, because the requester they record would
  not be one person.
- `piggyvest_primary.consume_two_approvals(action, subject_table, subject_id,
  row_version, amount_kobo, destination)` returns the request id, or raises.
  Call it in the same transaction as the money movement and pass the
  subject's **current** values, so a raise rolls the movement back.
- `action` is one of the rows of `piggyvest_primary.ops_approval_actions`.
- `destination` is `{"kind":"none"}`,
  `{"kind":"bank_account","bank_code":"<3-6 digits>","ref":"<10-digit NUBAN>"}`
  or `{"kind":"wallet","ref":"<provider wallet id>"}`, with an optional
  `"label"` shown to approvers after the masked destination. A label is a
  plain name of up to 60 characters: letters, single spaces and `& . , ' -`
  only, so it can carry no digits.
- `context` is a small object; only `"reason"` is shown to approvers and every
  other key is ignored.

## Switching it off

Nothing calls it yet. To stop all approvals later, the owner removes the
approver role from every approver login (above); no request can then be
carried out.
