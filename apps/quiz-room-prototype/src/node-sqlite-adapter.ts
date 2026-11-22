import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type {
  RoomStorageBackend,
  SqlBillingTotals,
  SqlExecResult,
  SqlRow,
  SqlValue,
} from './sqlite-adapter';

interface TableIndexMeta {
  extraIndexes: ReadonlyArray<{
    name: string;
    columns: ReadonlySet<string>;
  }>;
  extraIndexCount: number;
}

interface QueryPlanCacheEntry {
  kind: 'select' | 'insert' | 'update' | 'delete' | 'ddl' | 'other';
  tableName: string | null;
  isFullScan: boolean;
  updateSetColumns: ReadonlySet<string>;
}

function normalizeTableName(raw: string | undefined): string | null {
  if (!raw) return null;
  return raw.replace(/["`[\]]/g, '').trim();
}

function parseInsertTable(sql: string): string | null {
  const match =
    /^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+([A-Za-z0-9_"`[\].]+)/i.exec(sql);
  return normalizeTableName(match?.[1]);
}

function parseUpdateMeta(sql: string): {
  tableName: string | null;
  setColumns: ReadonlySet<string>;
} {
  const tableMatch = /^\s*UPDATE\s+(?:OR\s+\w+\s+)?([A-Za-z0-9_"`[\].]+)/i.exec(
    sql
  );
  const tableName = normalizeTableName(tableMatch?.[1]);
  const setMatch = /\bSET\s+([\s\S]+?)(?:\bWHERE\b|\bRETURNING\b|$)/i.exec(sql);
  const cols = new Set<string>();
  if (setMatch?.[1]) {
    const assignments = setMatch[1].split(',');
    for (const assignment of assignments) {
      const colMatch = /^\s*([A-Za-z0-9_"`[\]]+)\s*=/i.exec(assignment);
      if (colMatch?.[1]) {
        cols.add(colMatch[1].replace(/["`[\]]/g, '').trim());
      }
    }
  }
  return { tableName, setColumns: cols };
}

function parseDeleteTable(sql: string): string | null {
  const match = /^\s*DELETE\s+FROM\s+([A-Za-z0-9_"`[\].]+)/i.exec(sql);
  return normalizeTableName(match?.[1]);
}

function parseSelectPrimaryTable(sql: string): string | null {
  const match = /\bFROM\s+([A-Za-z0-9_"`[\].]+)/i.exec(sql);
  return normalizeTableName(match?.[1]);
}

/**
 * Node `node:sqlite` (`DatabaseSync`) backend for local Vitest, deterministic replay,
 * and scale benchmarks. Executes real SQLite queries and tracks exact Cloudflare DO
 * SQLite billing counters:
 * - `rowsWritten`: table writes + affected index entry writes + SQL delete writes
 * - `rowsRead`: rows read from index seeks or full table scans
 */
export class NodeSqliteAdapter implements RoomStorageBackend {
  private db: DatabaseSync;
  private readonly path: string;
  private alarmMs: number | null = null;
  private txDepth = 0;
  private totals: SqlBillingTotals = { rowsRead: 0, rowsWritten: 0 };
  private tableMetaCache = new Map<string, TableIndexMeta>();
  private queryPlanCache = new Map<string, QueryPlanCacheEntry>();
  private stmtCache = new Map<string, ReturnType<DatabaseSync['prepare']>>();

  constructor(path = ':memory:') {
    this.path = path;
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  }

  /** Reopens the underlying database connection (for file-backed restart simulations). */
  reopen(): void {
    this.stmtCache.clear();
    this.tableMetaCache.clear();
    this.queryPlanCache.clear();
    this.db.close();
    this.db = new DatabaseSync(this.path);
  }

  close(): void {
    this.stmtCache.clear();
    this.db.close();
  }

  private getPrepared(sql: string) {
    let stmt = this.stmtCache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  private getTableMeta(tableName: string): TableIndexMeta {
    const cached = this.tableMetaCache.get(tableName);
    if (cached) return cached;

    const ddlRow = this.db
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`
      )
      .get(tableName) as { sql?: string } | undefined;
    const isWithoutRowid =
      typeof ddlRow?.sql === 'string' &&
      /\bWITHOUT\s+ROWID\b/i.test(ddlRow.sql);

    const indexList = this.db
      .prepare(`PRAGMA index_list("${tableName}")`)
      .all() as Array<{ name?: string; origin?: string }>;

    const extraIndexes: Array<{ name: string; columns: ReadonlySet<string> }> =
      [];

    for (const idx of indexList) {
      if (!idx.name) continue;
      // In WITHOUT ROWID tables, the 'pk' autoindex IS the clustered table B-tree,
      // so it does not add a separate secondary index write.
      if (isWithoutRowid && idx.origin === 'pk') {
        continue;
      }
      const cols = new Set<string>();
      const infoRows = this.db
        .prepare(`PRAGMA index_info("${idx.name}")`)
        .all() as Array<{ name?: string | null }>;
      for (const col of infoRows) {
        if (typeof col.name === 'string') {
          cols.add(col.name);
        }
      }
      extraIndexes.push({ name: idx.name, columns: cols });
    }

    const meta: TableIndexMeta = {
      extraIndexes,
      extraIndexCount: extraIndexes.length,
    };
    this.tableMetaCache.set(tableName, meta);
    return meta;
  }

  private inspectQuery(sql: string): QueryPlanCacheEntry {
    const cached = this.queryPlanCache.get(sql);
    if (cached) return cached;

    const trimmed = sql.trimStart();
    if (/^(CREATE|ALTER|DROP|PRAGMA)\b/i.test(trimmed)) {
      const entry: QueryPlanCacheEntry = {
        kind: 'ddl',
        tableName: null,
        isFullScan: false,
        updateSetColumns: new Set(),
      };
      this.queryPlanCache.set(sql, entry);
      return entry;
    }

    let kind: QueryPlanCacheEntry['kind'] = 'other';
    let tableName: string | null = null;
    let updateSetColumns: ReadonlySet<string> = new Set();

    if (/^(SELECT|WITH)\b/i.test(trimmed)) {
      kind = 'select';
      tableName = parseSelectPrimaryTable(trimmed);
    } else if (/^INSERT\b/i.test(trimmed)) {
      kind = 'insert';
      tableName = parseInsertTable(trimmed);
    } else if (/^UPDATE\b/i.test(trimmed)) {
      kind = 'update';
      const parsed = parseUpdateMeta(trimmed);
      tableName = parsed.tableName;
      updateSetColumns = parsed.setColumns;
    } else if (/^DELETE\b/i.test(trimmed)) {
      kind = 'delete';
      tableName = parseDeleteTable(trimmed);
    }

    let isFullScan = false;
    if (kind === 'select' || kind === 'update' || kind === 'delete') {
      try {
        const planRows = this.db
          .prepare(`EXPLAIN QUERY PLAN ${sql}`)
          .all() as Array<{ detail?: string }>;
        isFullScan = planRows.some(
          (r) => typeof r.detail === 'string' && /\bSCAN\b/i.test(r.detail)
        );
      } catch {
        isFullScan = false;
      }
    }

    const entry: QueryPlanCacheEntry = {
      kind,
      tableName,
      isFullScan,
      updateSetColumns,
    };
    this.queryPlanCache.set(sql, entry);
    return entry;
  }

  exec<T extends SqlRow = SqlRow>(
    query: string,
    ...bindings: SqlValue[]
  ): SqlExecResult<T> {
    const info = this.inspectQuery(query);
    if (info.kind === 'ddl') {
      this.tableMetaCache.clear();
      this.queryPlanCache.clear();
      this.db.exec(query);
      return { rows: [], rowsRead: 0, rowsWritten: 0 };
    }

    const params = bindings as SQLInputValue[];
    const stmt = this.getPrepared(query);
    const hasReturning = /\bRETURNING\b/i.test(query);

    let rows: T[] = [];
    let changes = 0;

    if (info.kind === 'select' || hasReturning) {
      rows = stmt.all(...params) as T[];
      if (info.kind !== 'select') {
        const chRow = this.db.prepare('SELECT changes() AS c').get() as
          | { c?: number }
          | undefined;
        changes = Number(chRow?.c ?? rows.length);
      }
    } else {
      const result = stmt.run(...params);
      changes = Number(result.changes ?? 0);
    }

    let rowsRead = 0;
    let rowsWritten = 0;

    if (info.kind === 'select') {
      if (info.isFullScan && info.tableName) {
        const cnt = this.db
          .prepare(`SELECT count(*) AS c FROM "${info.tableName}"`)
          .get() as { c?: number } | undefined;
        rowsRead = Math.max(1, Number(cnt?.c ?? rows.length));
      } else {
        rowsRead = Math.max(1, rows.length);
      }
    } else if (info.kind === 'insert') {
      rowsRead = /\bON\s+CONFLICT\b/i.test(query) ? Math.max(1, changes) : 0;
      if (changes > 0 && info.tableName) {
        const meta = this.getTableMeta(info.tableName);
        rowsWritten = changes * (1 + meta.extraIndexCount);
      }
    } else if (info.kind === 'update') {
      if (info.isFullScan && info.tableName) {
        const cnt = this.db
          .prepare(`SELECT count(*) AS c FROM "${info.tableName}"`)
          .get() as { c?: number } | undefined;
        rowsRead = Math.max(1, Number(cnt?.c ?? changes));
      } else {
        rowsRead = Math.max(1, changes);
      }
      if (changes > 0 && info.tableName) {
        const meta = this.getTableMeta(info.tableName);
        let updatedIndexes = 0;
        for (const idx of meta.extraIndexes) {
          for (const col of info.updateSetColumns) {
            if (idx.columns.has(col)) {
              updatedIndexes += 1;
              break;
            }
          }
        }
        rowsWritten = changes * (1 + updatedIndexes);
      }
    } else if (info.kind === 'delete') {
      if (info.isFullScan && info.tableName) {
        const cnt = this.db
          .prepare(`SELECT count(*) AS c FROM "${info.tableName}"`)
          .get() as { c?: number } | undefined;
        rowsRead = Math.max(1, Number(cnt?.c ?? changes));
      } else {
        rowsRead = Math.max(1, changes);
      }
      if (changes > 0 && info.tableName) {
        const meta = this.getTableMeta(info.tableName);
        rowsWritten = changes * (1 + meta.extraIndexCount);
      }
    }

    this.totals.rowsRead += rowsRead;
    this.totals.rowsWritten += rowsWritten;
    return { rows, rowsRead, rowsWritten };
  }

  transactionSync<T>(fn: () => T): T {
    if (this.txDepth > 0) {
      return fn();
    }
    this.db.exec('BEGIN IMMEDIATE');
    this.txDepth += 1;
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Ignore rollback error if already aborted.
      }
      throw error;
    } finally {
      this.txDepth -= 1;
    }
  }

  getAlarm(): number | null {
    return this.alarmMs;
  }

  setAlarm(scheduledTimeMs: number): void {
    this.alarmMs = scheduledTimeMs;
  }

  deleteAlarm(): void {
    this.alarmMs = null;
  }

  deleteAll(): void {
    this.alarmMs = null;
    this.stmtCache.clear();
    this.tableMetaCache.clear();
    this.queryPlanCache.clear();
    const tables = this.db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
      )
      .all() as Array<{ name?: string }>;
    for (const tbl of tables) {
      if (tbl.name) {
        this.db.exec(`DROP TABLE IF EXISTS "${tbl.name}"`);
      }
    }
  }

  getBillingTotals(): SqlBillingTotals {
    return { ...this.totals };
  }

  resetBillingTotals(): void {
    this.totals = { rowsRead: 0, rowsWritten: 0 };
  }
}
