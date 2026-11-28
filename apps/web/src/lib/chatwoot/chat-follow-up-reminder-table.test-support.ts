/**
 * An in-memory `chat_follow_up_reminders` table behind the parts of the
 * Supabase query builder the reminder modules use. It mirrors the database
 * guard: every write stamps a new `revision`, and a new time gets a new id.
 */

export type FakeReminderRow = {
  id: string;
  revision: string;
  merchant_id: string;
  conversation_id: number;
  due_at: string;
  customer_name: string;
  processed_at: string | null;
};

type Written = Pick<
  FakeReminderRow,
  'merchant_id' | 'conversation_id' | 'due_at' | 'customer_name'
>;
type Filter = (row: FakeReminderRow) => boolean;

export function fakeReminderTable() {
  const rows: FakeReminderRow[] = [];
  let stamp = 0;
  const next = (kind: string) => `${kind}-${++stamp}`;
  const sameChat = (row: Written) => (other: FakeReminderRow) =>
    other.merchant_id === row.merchant_id &&
    other.conversation_id === row.conversation_id;
  const add = (row: Written) => {
    rows.push({
      ...row,
      id: next('id'),
      revision: next('rev'),
      processed_at: null,
    });
  };
  const change = (target: FakeReminderRow, values: Partial<Written>) => {
    if (values.due_at && values.due_at !== target.due_at) {
      target.id = next('id');
      target.processed_at = null;
    }
    Object.assign(target, values, { revision: next('rev') });
  };

  function query(run: (matches: Filter) => unknown) {
    const filters: Filter[] = [];
    const matches: Filter = (row) => filters.every((filter) => filter(row));
    const field = (row: FakeReminderRow, name: string) =>
      row[name as keyof FakeReminderRow];
    const builder = {
      eq(name: string, value: unknown) {
        filters.push((row) => field(row, name) === value);
        return builder;
      },
      neq(name: string, value: unknown) {
        filters.push((row) => field(row, name) !== value);
        return builder;
      },
      not(name: string, _operator: 'is', value: null) {
        filters.push((row) => field(row, name) !== value);
        return builder;
      },
      select: () => builder,
      maybeSingle: () => {
        const found = rows.find(matches);
        return Promise.resolve({
          data: found ? { ...found } : null,
          error: null,
        });
      },
      // biome-ignore lint/suspicious/noThenProperty: a query builder is awaited.
      then<Result>(resolve: (value: never) => Result) {
        return Promise.resolve(run(matches) as never).then(resolve);
      },
    };
    return builder;
  }

  const from = () => ({
    select: () => query(() => ({ data: rows, error: null })),
    insert: (row: Written) =>
      query(() => {
        if (rows.some(sameChat(row))) return { error: { code: '23505' } };
        add(row);
        return { error: null };
      }),
    upsert: (row: Written, options: { ignoreDuplicates?: boolean }) =>
      query(() => {
        const existing = rows.find(sameChat(row));
        if (!existing) add(row);
        else if (!options.ignoreDuplicates) change(existing, row);
        return { error: null };
      }),
    update: (values: Partial<Written>) =>
      query((matches) => {
        const changed = rows.filter(matches);
        for (const row of changed) change(row, values);
        return { data: changed.map(({ id }) => ({ id })), error: null };
      }),
    delete: () =>
      query((matches) => {
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          if (matches(rows[index])) rows.splice(index, 1);
        }
        return { error: null };
      }),
  });

  return { client: { from }, rows };
}
