export type DataJamSource = "stripe";

export type SyncMode = "full" | "incremental";

export type StripeResourceName =
  | "customers"
  | "products"
  | "prices"
  | "subscriptions"
  | "invoices"
  | "charges"
  | "refunds"
  | "payment_intents"
  | "checkout_sessions"
  | "balance_transactions"
  | "disputes"
  | "payouts"
  | "transfers";

export interface RuntimeConfig {
  stripeSecretKey?: string;
  projectDir: string;
  storage: {
    engine: "sqlite";
    sqlitePath: string;
  };
  dashboard: {
    port: number;
    host: string;
  };
  logLevel: "debug" | "info" | "warn" | "error";
}

export interface DataJamOptions {
  stripeSecretKey?: string;
  projectDir?: string;
  storage?: {
    engine?: "sqlite";
    sqlitePath?: string;
  };
  dashboard?: {
    port?: number;
    host?: string;
  };
  logLevel?: "debug" | "info" | "warn" | "error";
}

export interface TrackingEventInput {
  anonymousId: string;
  sessionId: string;
  eventName: string;
  eventType: "page_view" | "click" | "custom";
  path: string;
  url?: string;
  title?: string;
  referrer?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  properties?: Record<string, unknown>;
  userAgent?: string;
  language?: string;
  screenWidth?: number;
  screenHeight?: number;
  occurredAt?: string;
}

export interface SyncSummary {
  runId: string;
  mode: SyncMode;
  startedAt: string;
  completedAt: string;
  resources: Array<{
    resource: StripeResourceName;
    fetched: number;
    upserted: number;
    skipped: number;
  }>;
}

export interface DoctorReport {
  ok: boolean;
  checks: Array<{
    name: string;
    ok: boolean;
    message: string;
  }>;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface Checkpoint {
  resource: StripeResourceName;
  lastCursor: string | null;
  lastCreated: number | null;
  lastUpdated: number | null;
  updatedAt: string;
}

export interface RawObjectInput {
  source: DataJamSource;
  resource: StripeResourceName;
  stripeId: string;
  objectCreated: number | null;
  objectUpdated: number | null;
  payload: unknown;
}

export interface NormalizedRecordInput {
  source: DataJamSource;
  resource: StripeResourceName;
  stripeId: string;
  objectCreated: number | null;
  objectUpdated: number | null;
  isDeleted: boolean;
  data: Record<string, unknown>;
  rawObjectStripeId: string;
}

export interface StorageAdapter {
  init(): Promise<void>;
  close(): Promise<void>;

  createSyncRun(input: { mode: SyncMode; source: DataJamSource }): Promise<string>;
  completeSyncRun(input: { runId: string; status: "completed" | "failed"; error?: string }): Promise<void>;

  getCheckpoint(resource: StripeResourceName): Promise<Checkpoint | null>;
  setCheckpoint(
    resource: StripeResourceName,
    input: { lastCursor?: string | null; lastCreated?: number | null; lastUpdated?: number | null }
  ): Promise<void>;

  upsertRawObject(input: RawObjectInput): Promise<{ changed: boolean }>;
  upsertNormalizedRecord(input: NormalizedRecordInput): Promise<void>;
  insertTrackingEvent(input: TrackingEventInput): Promise<void>;

  getAnalyticsPoint(sql: string, params?: unknown[]): Promise<Record<string, unknown>>;
  getAnalyticsRows(sql: string, params?: unknown[]): Promise<Array<Record<string, unknown>>>;
}

export interface RetryPolicy {
  execute<T>(operation: () => Promise<T>, context: { resource: string; page: number }): Promise<T>;
}

export interface SyncContext {
  runId: string;
  mode: SyncMode;
  storage: StorageAdapter;
  logger: Logger;
  retry: RetryPolicy;
}

export interface ConnectorResourceSyncResult<T> {
  resource: StripeResourceName;
  records: T[];
  page: number;
  hasMore: boolean;
  nextCursor: string | null;
  maxCreated: number | null;
}

export interface SourceConnector {
  readonly source: DataJamSource;
  validateConnection(): Promise<void>;
  listSupportedResources(): StripeResourceName[];
  syncResource(
    resource: StripeResourceName,
    context: SyncContext
  ): AsyncGenerator<ConnectorResourceSyncResult<unknown>>;
}
