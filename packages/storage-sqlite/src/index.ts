import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type {
  Checkpoint,
  DataJamSource,
  NormalizedRecordInput,
  RawObjectInput,
  StorageAdapter,
  StripeResourceName,
  SyncMode,
  TrackingEventInput
} from "@datajam/types";

const RESOURCE_TABLES: Record<StripeResourceName, string> = {
  customers: "customers",
  products: "products",
  prices: "prices",
  subscriptions: "subscriptions",
  invoices: "invoices",
  charges: "charges",
  refunds: "refunds",
  payment_intents: "payment_intents",
  checkout_sessions: "checkout_sessions",
  balance_transactions: "balance_transactions",
  disputes: "disputes",
  payouts: "payouts",
  transfers: "transfers"
};

export interface SqliteStorageAdapterOptions {
  databasePath: string;
}

export class SqliteStorageAdapter implements StorageAdapter {
  private db: Database.Database;

  public constructor(private readonly options: SqliteStorageAdapterOptions) {
    if (!options.databasePath) {
      throw new Error("SqliteStorageAdapter requires databasePath");
    }
    this.db = new Database(options.databasePath);
  }

  public async init(): Promise<void> {
    await mkdir(dirname(this.options.databasePath), { recursive: true });
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_runs (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS sync_checkpoints (
        resource TEXT PRIMARY KEY,
        last_cursor TEXT,
        last_created INTEGER,
        last_updated INTEGER,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS stripe_raw_objects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        stripe_id TEXT NOT NULL,
        object_created INTEGER,
        object_updated INTEGER,
        payload_json TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        last_synced_at TEXT NOT NULL,
        UNIQUE(resource_type, stripe_id)
      );

      CREATE INDEX IF NOT EXISTS idx_raw_resource_created
      ON stripe_raw_objects(resource_type, object_created);

      CREATE TABLE IF NOT EXISTS visitors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        anonymous_id TEXT NOT NULL UNIQUE,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        user_agent TEXT,
        language TEXT
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL UNIQUE,
        anonymous_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        entry_path TEXT,
        referrer TEXT,
        source TEXT,
        medium TEXT,
        campaign TEXT
      );

      CREATE TABLE IF NOT EXISTS page_views (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        anonymous_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        path TEXT NOT NULL,
        url TEXT,
        title TEXT,
        referrer TEXT,
        source TEXT,
        medium TEXT,
        campaign TEXT,
        properties_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        anonymous_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        event_name TEXT NOT NULL,
        event_type TEXT NOT NULL,
        path TEXT NOT NULL,
        url TEXT,
        properties_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_page_views_occurred_at ON page_views(occurred_at);
      CREATE INDEX IF NOT EXISTS idx_page_views_path ON page_views(path);
      CREATE INDEX IF NOT EXISTS idx_events_name ON events(event_name);
      CREATE INDEX IF NOT EXISTS idx_events_occurred_at ON events(occurred_at);
    `);

    for (const tableName of Object.values(RESOURCE_TABLES)) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS ${tableName} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          stripe_id TEXT NOT NULL UNIQUE,
          object_created INTEGER,
          object_updated INTEGER,
          is_deleted INTEGER NOT NULL DEFAULT 0,
          raw_object_stripe_id TEXT NOT NULL,
          data_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_${tableName}_created ON ${tableName}(object_created);
      `);
    }
  }

  public async close(): Promise<void> {
    this.db.close();
  }

  public async createSyncRun(input: { mode: SyncMode; source: DataJamSource }): Promise<string> {
    const runId = randomUUID();
    const statement = this.db.prepare(`
      INSERT INTO sync_runs (id, source, mode, status, started_at)
      VALUES (?, ?, ?, 'running', ?)
    `);
    statement.run(runId, input.source, input.mode, new Date().toISOString());
    return runId;
  }

  public async completeSyncRun(input: {
    runId: string;
    status: "completed" | "failed";
    error?: string;
  }): Promise<void> {
    const statement = this.db.prepare(`
      UPDATE sync_runs
      SET status = ?, error = ?, finished_at = ?
      WHERE id = ?
    `);
    statement.run(input.status, input.error ?? null, new Date().toISOString(), input.runId);
  }

  public async getCheckpoint(resource: StripeResourceName): Promise<Checkpoint | null> {
    const statement = this.db.prepare(`
      SELECT resource, last_cursor, last_created, last_updated, updated_at
      FROM sync_checkpoints
      WHERE resource = ?
    `);
    const row = statement.get(resource) as
      | {
          resource: StripeResourceName;
          last_cursor: string | null;
          last_created: number | null;
          last_updated: number | null;
          updated_at: string;
        }
      | undefined;
    if (!row) {
      return null;
    }

    return {
      resource: row.resource,
      lastCursor: row.last_cursor,
      lastCreated: row.last_created,
      lastUpdated: row.last_updated,
      updatedAt: row.updated_at
    };
  }

  public async setCheckpoint(
    resource: StripeResourceName,
    input: { lastCursor?: string | null; lastCreated?: number | null; lastUpdated?: number | null }
  ): Promise<void> {
    const statement = this.db.prepare(`
      INSERT INTO sync_checkpoints (resource, last_cursor, last_created, last_updated, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(resource) DO UPDATE SET
        last_cursor = excluded.last_cursor,
        last_created = excluded.last_created,
        last_updated = excluded.last_updated,
        updated_at = excluded.updated_at
    `);
    statement.run(
      resource,
      input.lastCursor ?? null,
      input.lastCreated ?? null,
      input.lastUpdated ?? null,
      new Date().toISOString()
    );
  }

  public async upsertRawObject(input: RawObjectInput): Promise<{ changed: boolean }> {
    const payloadJson = JSON.stringify(input.payload);
    const payloadHash = createHash("sha256").update(payloadJson).digest("hex");
    const existing = this.db
      .prepare(
        `
      SELECT payload_hash
      FROM stripe_raw_objects
      WHERE resource_type = ? AND stripe_id = ?
    `
      )
      .get(input.resource, input.stripeId) as { payload_hash: string } | undefined;

    if (existing && existing.payload_hash === payloadHash) {
      this.db
        .prepare(
          `
        UPDATE stripe_raw_objects
        SET last_synced_at = ?
        WHERE resource_type = ? AND stripe_id = ?
      `
        )
        .run(new Date().toISOString(), input.resource, input.stripeId);
      return { changed: false };
    }

    this.db
      .prepare(
        `
      INSERT INTO stripe_raw_objects
      (source, resource_type, stripe_id, object_created, object_updated, payload_json, payload_hash, last_synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(resource_type, stripe_id) DO UPDATE SET
        object_created = excluded.object_created,
        object_updated = excluded.object_updated,
        payload_json = excluded.payload_json,
        payload_hash = excluded.payload_hash,
        last_synced_at = excluded.last_synced_at
    `
      )
      .run(
        input.source,
        input.resource,
        input.stripeId,
        input.objectCreated ?? null,
        input.objectUpdated ?? null,
        payloadJson,
        payloadHash,
        new Date().toISOString()
      );
    return { changed: true };
  }

  public async upsertNormalizedRecord(input: NormalizedRecordInput): Promise<void> {
    const tableName = RESOURCE_TABLES[input.resource];
    const statement = this.db.prepare(`
      INSERT INTO ${tableName}
      (stripe_id, object_created, object_updated, is_deleted, raw_object_stripe_id, data_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(stripe_id) DO UPDATE SET
        object_created = excluded.object_created,
        object_updated = excluded.object_updated,
        is_deleted = excluded.is_deleted,
        raw_object_stripe_id = excluded.raw_object_stripe_id,
        data_json = excluded.data_json,
        updated_at = excluded.updated_at
    `);
    statement.run(
      input.stripeId,
      input.objectCreated ?? null,
      input.objectUpdated ?? null,
      input.isDeleted ? 1 : 0,
      input.rawObjectStripeId,
      JSON.stringify(input.data),
      new Date().toISOString()
    );
  }

  public async insertTrackingEvent(input: TrackingEventInput): Promise<void> {
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const propertiesJson = JSON.stringify(input.properties ?? {});

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `
          INSERT INTO visitors (anonymous_id, first_seen_at, last_seen_at, user_agent, language)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(anonymous_id) DO UPDATE SET
            last_seen_at = excluded.last_seen_at,
            user_agent = COALESCE(excluded.user_agent, visitors.user_agent),
            language = COALESCE(excluded.language, visitors.language)
        `
        )
        .run(input.anonymousId, occurredAt, occurredAt, input.userAgent ?? null, input.language ?? null);

      this.db
        .prepare(
          `
          INSERT INTO sessions
          (session_id, anonymous_id, started_at, last_seen_at, entry_path, referrer, source, medium, campaign)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET
            last_seen_at = excluded.last_seen_at
        `
        )
        .run(
          input.sessionId,
          input.anonymousId,
          occurredAt,
          occurredAt,
          input.path,
          input.referrer ?? null,
          input.source ?? null,
          input.medium ?? null,
          input.campaign ?? null
        );

      if (input.eventType === "page_view") {
        this.db
          .prepare(
            `
            INSERT INTO page_views
            (anonymous_id, session_id, path, url, title, referrer, source, medium, campaign, properties_json, occurred_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
          )
          .run(
            input.anonymousId,
            input.sessionId,
            input.path,
            input.url ?? null,
            input.title ?? null,
            input.referrer ?? null,
            input.source ?? null,
            input.medium ?? null,
            input.campaign ?? null,
            propertiesJson,
            occurredAt
          );
      }

      this.db
        .prepare(
          `
          INSERT INTO events
          (anonymous_id, session_id, event_name, event_type, path, url, properties_json, occurred_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          input.anonymousId,
          input.sessionId,
          input.eventName,
          input.eventType,
          input.path,
          input.url ?? null,
          propertiesJson,
          occurredAt
        );
    });

    transaction();
  }

  public async getAnalyticsPoint(sql: string, params: unknown[] = []): Promise<Record<string, unknown>> {
    const row = this.db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
    return row ?? {};
  }

  public async getAnalyticsRows(
    sql: string,
    params: unknown[] = []
  ): Promise<Array<Record<string, unknown>>> {
    return this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  }
}
