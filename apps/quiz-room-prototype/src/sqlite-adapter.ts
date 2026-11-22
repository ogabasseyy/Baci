export type SqlValue = string | number | bigint | Uint8Array | null;

export type SqlRow = Record<string, SqlValue>;

export interface SqlExecResult<T extends SqlRow = SqlRow> {
  rows: T[];
  rowsRead: number;
  rowsWritten: number;
}

export interface SqlBillingTotals {
  rowsRead: number;
  rowsWritten: number;
}

export interface RoomStorageBackend {
  exec<T extends SqlRow = SqlRow>(
    query: string,
    ...bindings: SqlValue[]
  ): SqlExecResult<T>;
  transactionSync<T>(fn: () => T): T;
  getAlarm(): number | null;
  setAlarm(scheduledTimeMs: number): void;
  deleteAlarm(): void;
  deleteAll(): void;
  getBillingTotals(): SqlBillingTotals;
  resetBillingTotals(): void;
}

/**
 * Minimal structural subset of Cloudflare DurableObjectStorage / SqlStorage
 * so `CloudflareSqlStorageAdapter` works cleanly against `workerd` types.
 */
export interface CloudflareSqlCursorLike {
  toArray(): Record<string, unknown>[];
  readonly rowsRead: number;
  readonly rowsWritten: number;
}

export interface CloudflareSqlStorageLike {
  exec(query: string, ...bindings: unknown[]): CloudflareSqlCursorLike;
}

export interface CloudflareDoStorageLike {
  readonly sql: CloudflareSqlStorageLike;
  transactionSync<T>(closure: () => T): T;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
  deleteAlarm(): Promise<void>;
  deleteAll(): Promise<void>;
}

/**
 * Adapter wrapping Cloudflare Durable Object `ctx.storage` (`workerd` SQLite).
 */
export class CloudflareSqlStorageAdapter implements RoomStorageBackend {
  private readonly storage: CloudflareDoStorageLike;
  private alarmMs: number | null = null;
  private totals: SqlBillingTotals = { rowsRead: 0, rowsWritten: 0 };

  constructor(
    storage: CloudflareDoStorageLike,
    initialAlarmMs: number | null = null
  ) {
    this.storage = storage;
    this.alarmMs = initialAlarmMs;
  }

  exec<T extends SqlRow = SqlRow>(
    query: string,
    ...bindings: SqlValue[]
  ): SqlExecResult<T> {
    const cursor = this.storage.sql.exec(query, ...bindings);
    const rows = cursor.toArray() as T[];
    const rowsRead = Number.isFinite(cursor.rowsRead)
      ? cursor.rowsRead
      : rows.length;
    const rowsWritten = Number.isFinite(cursor.rowsWritten)
      ? cursor.rowsWritten
      : 0;
    this.totals.rowsRead += rowsRead;
    this.totals.rowsWritten += rowsWritten;
    return { rows, rowsRead, rowsWritten };
  }

  transactionSync<T>(fn: () => T): T {
    return this.storage.transactionSync(fn);
  }

  getAlarm(): number | null {
    return this.alarmMs;
  }

  setAlarm(scheduledTimeMs: number): void {
    this.alarmMs = scheduledTimeMs;
    void this.storage.setAlarm(scheduledTimeMs);
  }

  deleteAlarm(): void {
    this.alarmMs = null;
    void this.storage.deleteAlarm();
  }

  deleteAll(): void {
    this.alarmMs = null;
    void this.storage.deleteAll();
  }

  getBillingTotals(): SqlBillingTotals {
    return { ...this.totals };
  }

  resetBillingTotals(): void {
    this.totals = { rowsRead: 0, rowsWritten: 0 };
  }
}
