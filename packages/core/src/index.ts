import { access, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import createJiti from "jiti";
import type {
  DataJamOptions,
  DoctorReport,
  Logger,
  RetryPolicy,
  RuntimeConfig,
  SourceConnector,
  StorageAdapter,
  StripeResourceName,
  SyncMode,
  SyncSummary
} from "@datajam/types";

const RESOURCE_ORDER: StripeResourceName[] = [
  "products",
  "prices",
  "customers",
  "subscriptions",
  "invoices",
  "charges",
  "refunds",
  "payment_intents",
  "checkout_sessions",
  "balance_transactions",
  "disputes",
  "payouts",
  "transfers"
];

export interface AnalyticsProvider {
  getDashboardMetrics(): Promise<unknown>;
  getRevenueOverTime(): Promise<unknown>;
  getTopProducts(limit?: number): Promise<unknown>;
}

export interface DashboardHandle {
  url: string;
  stop(): Promise<void>;
}

export type DashboardStarter = (input: {
  config: RuntimeConfig;
  analytics: AnalyticsProvider;
  logger: Logger;
}) => Promise<DashboardHandle>;

export interface DataJamCoreDependencies {
  connector: SourceConnector;
  storage: StorageAdapter;
  analytics: AnalyticsProvider;
  dashboardStarter: DashboardStarter;
  logger?: Logger;
}

class ConsoleLogger implements Logger {
  public constructor(private readonly level: RuntimeConfig["logLevel"]) {}

  public debug(message: string, context?: Record<string, unknown>): void {
    if (this.level === "debug") {
      console.debug(`[datajam] ${message}`, context ?? "");
    }
  }
  public info(message: string, context?: Record<string, unknown>): void {
    if (this.level === "debug" || this.level === "info") {
      console.info(`[datajam] ${message}`, context ?? "");
    }
  }
  public warn(message: string, context?: Record<string, unknown>): void {
    if (this.level !== "error") {
      console.warn(`[datajam] ${message}`, context ?? "");
    }
  }
  public error(message: string, context?: Record<string, unknown>): void {
    console.error(`[datajam] ${message}`, context ?? "");
  }
}

export class ExponentialRetryPolicy implements RetryPolicy {
  public constructor(
    private readonly logger: Logger,
    private readonly options: { maxAttempts: number; baseDelayMs: number } = {
      maxAttempts: 5,
      baseDelayMs: 500
    }
  ) {}

  public async execute<T>(operation: () => Promise<T>, context: { resource: string; page: number }): Promise<T> {
    let attempt = 0;
    let lastError: unknown = null;
    while (attempt < this.options.maxAttempts) {
      attempt += 1;
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt >= this.options.maxAttempts) {
          break;
        }
        const retryAfterSeconds = this.readRetryAfterSeconds(error);
        const jitter = Math.floor(Math.random() * 100);
        const fallbackDelay = this.options.baseDelayMs * 2 ** (attempt - 1) + jitter;
        const delayMs = retryAfterSeconds ? retryAfterSeconds * 1000 : fallbackDelay;
        this.logger.warn("Retrying failed request", {
          resource: context.resource,
          page: context.page,
          attempt,
          delayMs
        });
        await wait(delayMs);
      }
    }
    throw lastError;
  }

  private readRetryAfterSeconds(error: unknown): number | null {
    const retryAfter = (error as { headers?: { ["retry-after"]?: string } } | null)?.headers?.["retry-after"];
    if (!retryAfter) {
      return null;
    }
    const asNumber = Number(retryAfter);
    return Number.isFinite(asNumber) ? asNumber : null;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DataJamCore {
  private readonly logger: Logger;
  private readonly retryPolicy: RetryPolicy;

  public constructor(
    private readonly config: RuntimeConfig,
    private readonly dependencies: DataJamCoreDependencies
  ) {
    this.logger = dependencies.logger ?? new ConsoleLogger(config.logLevel);
    this.retryPolicy = new ExponentialRetryPolicy(this.logger);
  }

  public async init(): Promise<void> {
    await ensureDataJamDirectory(this.config.projectDir);
    await this.dependencies.storage.init();
    await this.persistResolvedConfig();
  }

  public async sync(input: { full?: boolean } = {}): Promise<SyncSummary> {
    const mode: SyncMode = input.full ? "full" : "incremental";
    const runId = await this.dependencies.storage.createSyncRun({ mode, source: "stripe" });
    const startedAt = new Date().toISOString();
    const resourcesSummary: SyncSummary["resources"] = [];

    try {
      await this.dependencies.connector.validateConnection();
      for (const resource of RESOURCE_ORDER) {
        const resourceSummary = {
          resource,
          fetched: 0,
          upserted: 0,
          skipped: 0
        };
        for await (const pageResult of this.dependencies.connector.syncResource(resource, {
          runId,
          mode,
          storage: this.dependencies.storage,
          logger: this.logger,
          retry: this.retryPolicy
        })) {
          for (const record of pageResult.records) {
            resourceSummary.fetched += 1;
            const stripeObject = record as Record<string, unknown>;
            const stripeId = String(stripeObject.id ?? "");
            if (!stripeId) {
              continue;
            }

            const objectCreated = readObjectCreated(stripeObject);
            const changed = await this.dependencies.storage.upsertRawObject({
              source: "stripe",
              resource,
              stripeId,
              objectCreated,
              objectUpdated: null,
              payload: stripeObject
            });

            if (!changed.changed) {
              resourceSummary.skipped += 1;
              continue;
            }

            await this.dependencies.storage.upsertNormalizedRecord({
              source: "stripe",
              resource,
              stripeId,
              objectCreated,
              objectUpdated: null,
              isDeleted: false,
              data: stripeObject,
              rawObjectStripeId: stripeId
            });
            resourceSummary.upserted += 1;
          }

          await this.dependencies.storage.setCheckpoint(resource, {
            lastCursor: pageResult.hasMore ? pageResult.nextCursor : null,
            lastCreated: pageResult.maxCreated
          });
        }
        resourcesSummary.push(resourceSummary);
      }
      await this.dependencies.storage.completeSyncRun({ runId, status: "completed" });
      return {
        runId,
        mode,
        startedAt,
        completedAt: new Date().toISOString(),
        resources: resourcesSummary
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown sync error";
      await this.dependencies.storage.completeSyncRun({ runId, status: "failed", error: message });
      throw error;
    }
  }

  public async dashboard(input: { port?: number } = {}): Promise<DashboardHandle> {
    const port = input.port ?? this.config.dashboard.port;
    return this.dependencies.dashboardStarter({
      config: {
        ...this.config,
        dashboard: {
          ...this.config.dashboard,
          port
        }
      },
      analytics: this.dependencies.analytics,
      logger: this.logger
    });
  }

  public async start(): Promise<{ sync: SyncSummary; url: string; stop(): Promise<void> }> {
    await this.init();
    const sync = await this.sync();
    const dashboard = await this.dashboard();
    return {
      sync,
      url: dashboard.url,
      stop: dashboard.stop
    };
  }

  public async doctor(): Promise<DoctorReport> {
    const checks: DoctorReport["checks"] = [];
    const dbPath = this.config.storage.sqlitePath;
    checks.push({
      name: "Project directory",
      ok: existsSync(this.config.projectDir),
      message: this.config.projectDir
    });
    checks.push({
      name: "Datajam directory",
      ok: existsSync(join(this.config.projectDir, ".datajam")),
      message: join(this.config.projectDir, ".datajam")
    });
    checks.push({
      name: "SQLite path writable",
      ok: await this.canWritePath(dbPath),
      message: dbPath
    });
    checks.push({
      name: "Stripe key configured",
      ok: Boolean(this.config.stripeSecretKey),
      message: this.config.stripeSecretKey
        ? "configured"
        : "missing STRIPE_SECRET_KEY (or STRIPE_SECRET_KEY_LIVE / STRIPE_SECRET_KEY_TEST)"
    });
    return {
      ok: checks.every((check) => check.ok),
      checks
    };
  }

  private async persistResolvedConfig(): Promise<void> {
    const path = join(this.config.projectDir, ".datajam", "config.json");
    await writeFile(path, JSON.stringify(this.config, null, 2), "utf8");
  }

  private async canWritePath(path: string): Promise<boolean> {
    try {
      await mkdir(dirname(path), { recursive: true });
      await access(dirname(path));
      return true;
    } catch {
      return false;
    }
  }
}

function readObjectCreated(record: Record<string, unknown>): number | null {
  const created = record.created;
  if (typeof created === "number") {
    return created;
  }
  return null;
}

export function resolveStripeSecretKey(): string | undefined {
  return (
    process.env.STRIPE_SECRET_KEY ??
    process.env.STRIPE_SECRET_KEY_LIVE ??
    process.env.STRIPE_SECRET_KEY_TEST
  );
}

export function createDefaultConfig(): RuntimeConfig {
  const projectDir = process.cwd();
  return {
    stripeSecretKey: resolveStripeSecretKey(),
    projectDir,
    storage: {
      engine: "sqlite",
      sqlitePath: join(projectDir, ".datajam", "datajam.db")
    },
    dashboard: {
      port: 3210,
      host: "127.0.0.1"
    },
    logLevel: "info"
  };
}

export async function loadRuntimeConfig(options?: DataJamOptions): Promise<RuntimeConfig> {
  const defaults = createDefaultConfig();
  const projectDir = options?.projectDir ?? defaults.projectDir;
  const fileConfig = await loadConfigFile(projectDir);
  const merged: RuntimeConfig = {
    ...defaults,
    ...fileConfig,
    ...options,
    projectDir,
    stripeSecretKey: options?.stripeSecretKey ?? fileConfig?.stripeSecretKey ?? defaults.stripeSecretKey,
    storage: {
      ...defaults.storage,
      ...fileConfig?.storage,
      ...options?.storage,
      sqlitePath:
        options?.storage?.sqlitePath ??
        fileConfig?.storage?.sqlitePath ??
        join(projectDir, ".datajam", "datajam.db")
    },
    dashboard: {
      ...defaults.dashboard,
      ...fileConfig?.dashboard,
      ...options?.dashboard
    },
    logLevel: options?.logLevel ?? fileConfig?.logLevel ?? defaults.logLevel
  };
  return merged;
}

async function loadConfigFile(projectDir: string): Promise<Partial<RuntimeConfig> | null> {
  const configPath = join(projectDir, "datajam.config.ts");
  if (!existsSync(configPath)) {
    return null;
  }
  const jiti = createJiti(projectDir);
  const loaded = (await jiti.import(configPath, { default: true })) as Partial<RuntimeConfig> | undefined;
  return loaded ?? null;
}

export async function ensureDataJamDirectory(projectDir: string): Promise<void> {
  await mkdir(join(projectDir, ".datajam"), { recursive: true });
  await mkdir(join(projectDir, ".datajam", "logs"), { recursive: true });
  await mkdir(join(projectDir, ".datajam", "cache"), { recursive: true });
}

export async function writeDefaultConfigFile(projectDir: string): Promise<void> {
  const configPath = join(projectDir, "datajam.config.ts");
  if (existsSync(configPath)) {
    return;
  }
  const contents = `export default {
  stripeSecretKey:
    process.env.STRIPE_SECRET_KEY ??
    process.env.STRIPE_SECRET_KEY_LIVE ??
    process.env.STRIPE_SECRET_KEY_TEST,
  storage: {
    engine: "sqlite"
  },
  dashboard: {
    port: 3210
  }
};
`;
  await writeFile(configPath, contents, "utf8");
}
