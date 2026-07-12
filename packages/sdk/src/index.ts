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
import type { IncomingMessage, ServerResponse } from "node:http";
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

export interface TrackingEvent {
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

type DataJamRequest = IncomingMessage & {
  body?: unknown;
};

type DataJamResponse = ServerResponse & {
  status?: (code: number) => DataJamResponse;
  json?: (body: unknown) => void;
};

export type DataJamMiddleware = (
  request: DataJamRequest,
  response: DataJamResponse,
  next?: (error?: unknown) => void
) => void;

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

  public async track(input: TrackingEvent | TrackingEvent[]): Promise<void> {
    await this.init();
    if (!this.storage) {
      throw new Error("DataJam storage is not initialized");
    }

    const events = Array.isArray(input) ? input : [input];
    for (const event of events) {
      this.validateTrackingEvent(event);
      await this.storage.insertTrackingEvent(event);
    }
  }

  public middleware(): DataJamMiddleware {
    return (request, response, next) => {
      void this.handleTrackingRequest(request, response, next);
    };
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

  private async handleTrackingRequest(
    request: DataJamRequest,
    response: DataJamResponse,
    next?: (error?: unknown) => void
  ): Promise<void> {
    try {
      const pathname = request.url?.split("?")[0] ?? "/";
      if (request.method === "OPTIONS") {
        this.writeJson(response, 204, null);
        return;
      }

      if (request.method !== "POST" || !["/", "/events", "/track"].includes(pathname)) {
        next?.();
        return;
      }

      const body = request.body ?? (await readJsonBody(request));
      const events = normalizeTrackingPayload(body);
      await this.track(events);
      this.writeJson(response, 202, { ok: true, accepted: events.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to ingest DataJam event";
      this.writeJson(response, 400, { ok: false, error: message });
    }
  }

  private validateTrackingEvent(event: TrackingEvent): void {
    if (!event.anonymousId || !event.sessionId || !event.eventName || !event.eventType || !event.path) {
      throw new Error("Tracking event is missing required fields");
    }
    if (!["page_view", "click", "custom"].includes(event.eventType)) {
      throw new Error(`Unsupported tracking event type: ${event.eventType}`);
    }
  }

  private writeJson(response: DataJamResponse, statusCode: number, body: unknown): void {
    if (typeof response.status === "function" && typeof response.json === "function") {
      const jsonResponse = response.status(statusCode);
      jsonResponse.json?.(body);
      return;
    }

    response.statusCode = statusCode;
    if (body === null) {
      response.end();
      return;
    }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(body));
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > 128 * 1024) {
      throw new Error("Tracking payload is too large");
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function normalizeTrackingPayload(payload: unknown): TrackingEvent[] {
  const value = payload as { events?: unknown[]; event?: unknown };
  const events: unknown[] = Array.isArray(value.events)
    ? value.events
    : Array.isArray(payload)
      ? payload
      : value.event
        ? [value.event]
        : [payload];

  return events.map((event: unknown) => event as TrackingEvent);
}

function configurePublishedDashboardRoot(): void {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const bundledDashboard = join(packageRoot, "dashboard-app");
  if (existsSync(join(bundledDashboard, "app"))) {
    process.env.DATAJAM_DASHBOARD_ROOT = bundledDashboard;
  }
}
