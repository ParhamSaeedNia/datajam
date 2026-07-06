import { AnalyticsService } from "@datajam/analytics";
import { StripeConnector } from "@datajam/connector-stripe";
import {
  DataJamCore,
  ensureDataJamDirectory,
  loadRuntimeConfig,
  writeDefaultConfigFile
} from "@datajam/core";
import { startDashboardServer } from "@datajam/dashboard";
import { SqliteStorageAdapter } from "@datajam/storage-sqlite";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export { loadRuntimeConfig, ensureDataJamDirectory, writeDefaultConfigFile };

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

export interface SyncSummary {
  runId: string;
  mode: "full" | "incremental";
  startedAt: string;
  completedAt: string;
  resources: Array<{
    resource: string;
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

export class DataJam {
  private readonly options: DataJamOptions | undefined;
  private core: DataJamCore | null = null;
  private storage: SqliteStorageAdapter | null = null;

  public constructor(options?: DataJamOptions) {
    this.options = options;
  }

  public async init(): Promise<void> {
    const core = await this.getCore();
    await core.init();
  }

  public async sync(input: { full?: boolean } = {}): Promise<SyncSummary> {
    const core = await this.getCore();
    return core.sync(input);
  }

  public async dashboard(input: { port?: number } = {}): Promise<{ url: string; stop(): Promise<void> }> {
    const core = await this.getCore();
    return core.dashboard(input);
  }

  public async start(): Promise<{ sync: SyncSummary; url: string; stop(): Promise<void> }> {
    const core = await this.getCore();
    return core.start();
  }

  public async doctor(): Promise<DoctorReport> {
    const core = await this.getCore();
    return core.doctor();
  }

  private async getCore(): Promise<DataJamCore> {
    if (this.core) {
      return this.core;
    }

    configurePublishedDashboardRoot();
    const config = await loadRuntimeConfig(this.options);
    await writeDefaultConfigFile(config.projectDir);
    await ensureDataJamDirectory(config.projectDir);

    this.storage = new SqliteStorageAdapter({
      databasePath: config.storage.sqlitePath
    });

    const connector = new StripeConnector({
      apiKey: config.stripeSecretKey ?? ""
    });
    const analytics = new AnalyticsService(this.storage);
    this.core = new DataJamCore(config, {
      connector,
      storage: this.storage,
      analytics,
      dashboardStarter: startDashboardServer
    });
    return this.core;
  }
}

function configurePublishedDashboardRoot(): void {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const bundledDashboard = join(packageRoot, "dashboard-app");
  if (existsSync(join(bundledDashboard, "app"))) {
    process.env.DATAJAM_DASHBOARD_ROOT = bundledDashboard;
  }
}
