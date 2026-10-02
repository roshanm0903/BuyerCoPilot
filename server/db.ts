import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { runMigrations } from './migrations/runner';

export interface ExecutedQuery {
  sql: string;
  params: unknown[];
  rowCount: number;
  durationMs: number;
}

export const queryTraceStorage = new AsyncLocalStorage<{ queries: ExecutedQuery[] }>();

let dbInstance: Database | null = null;
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'procurement.sqlite');

/**
 * Ensures data directory exists
 */
function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Persists the sql.js database buffer safely to disk
 */
export async function persistDb(): Promise<void> {
  if (!dbInstance) return;
  try {
    ensureDataDir();
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (err) {
    console.error('[Database Persistence] Error writing to disk:', err);
    throw err;
  }
}

/**
 * Initializes or loads the persistent SQLite database
 */
export async function getDb(): Promise<Database> {
  if (dbInstance) return dbInstance;

  ensureDataDir();
  const SQL = await initSqlJs();

  let db: Database;
  const isExistingDb = fs.existsSync(DB_PATH);

  if (isExistingDb) {
    console.log(`[Database] Loading existing database from ${DB_PATH}...`);
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    console.log(`[Database] Initializing new SQLite database at ${DB_PATH}...`);
    db = new SQL.Database();
  }

  // Always enforce foreign keys
  db.run('PRAGMA foreign_keys = ON;');

  // Run versioned migrations (seeds demo data only on version < 3)
  const applied = runMigrations(db);
  if (applied > 0 || !isExistingDb) {
    dbInstance = db;
    await persistDb();
    console.log(`[Database] ${applied} migration(s) applied and database saved to disk.`);
  }

  dbInstance = db;
  return db;
}

/**
 * Executes a parameterized SELECT query and returns rows as objects.
 * Properly preserves NULLs, 0s, and typed values.
 */
export async function runQuery(sqlText: string, params: any[] = []): Promise<any[]> {
  const startedAt = Date.now();
  const db = await getDb();
  let stmt: any = null;
  try {
    stmt = db.prepare(sqlText);
    if (params && params.length > 0) {
      stmt.bind(params);
    }
    const rows: any[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    const trace = queryTraceStorage.getStore();
    if (trace) {
      trace.queries.push({
        sql: sqlText.trim(),
        params: [...params],
        rowCount: rows.length,
        durationMs: Date.now() - startedAt,
      });
    }
    return rows;
  } catch (err) {
    console.error('Database query error:', err, 'SQL:', sqlText, 'Params:', params);
    throw err;
  } finally {
    if (stmt) {
      try {
        stmt.free();
      } catch (e) {
        // ignore free error
      }
    }
  }
}

/**
 * Executes an INSERT, UPDATE, or DELETE with parameters and persists changes immediately.
 */
export async function runExecute(sqlText: string, params: any[] = []): Promise<void> {
  const db = await getDb();
  try {
    db.run(sqlText, params);
    await persistDb();
  } catch (err) {
    console.error('Database execute error:', err, 'SQL:', sqlText, 'Params:', params);
    throw err;
  }
}

/**
 * Runs multiple database operations inside an atomic transaction.
 * If any operation fails, the transaction is rolled back and no partial records remain.
 */
export async function runTransaction<T>(fn: (db: Database) => Promise<T> | T): Promise<T> {
  const db = await getDb();
  db.run('BEGIN TRANSACTION;');
  try {
    const result = await fn(db);
    db.run('COMMIT;');
    await persistDb();
    return result;
  } catch (err) {
    try {
      db.run('ROLLBACK;');
    } catch (rbErr) {
      console.error('Rollback error:', rbErr);
    }
    console.error('Transaction failed and was rolled back:', err);
    throw err;
  }
}

/**
 * Resets the database: deletes the file on disk and reinitializes with seed migrations.
 */
export async function resetDatabase(): Promise<void> {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch (e) {
      // ignore
    }
    dbInstance = null;
  }

  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
    console.log(`[Database Reset] Deleted ${DB_PATH}.`);
  }

  await getDb();
  console.log('[Database Reset] Database successfully re-created and seeded.');
}
