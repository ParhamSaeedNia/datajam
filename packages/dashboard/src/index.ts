import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import next from "next";
import type { Logger, RuntimeConfig } from "@datajam/types";
import { handleOverviewRequest } from "./overview-handler.js";

function resolveDashboardRoot(moduleUrl: string): string {
  const configuredRoot = process.env.DATAJAM_DASHBOARD_ROOT;
  if (configuredRoot && existsSync(join(configuredRoot, "app"))) {
    return configuredRoot;
  }
  return join(dirname(fileURLToPath(moduleUrl)), "..");
}

export const startDashboardServer = async ({
  config,
  logger
}: {
  config: RuntimeConfig;
  logger: Logger;
}): Promise<{ url: string; stop(): Promise<void> }> => {
  const dashboardRoot = resolveDashboardRoot(import.meta.url);
  const hasProductionBuild = existsSync(join(dashboardRoot, ".next", "BUILD_ID"));
  const dev = !hasProductionBuild;

  if (dev) {
    logger.info("Starting dashboard in dev mode (run pnpm build in packages/dashboard for production mode)");
  }

  const app = next({
    dev,
    dir: dashboardRoot,
    hostname: config.dashboard.host,
    port: config.dashboard.port
  });
  await app.prepare();
  const handler = app.getRequestHandler();
  const server = createServer((request, response) => {
    const pathname = request.url?.split("?")[0];
    if (pathname === "/api/overview") {
      void handleOverviewRequest(config.storage.sqlitePath, response);
      return;
    }
    handler(request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(config.dashboard.port, config.dashboard.host, () => resolve());
    server.once("error", reject);
  });

  const url = `http://${config.dashboard.host}:${config.dashboard.port}`;
  logger.info("Dashboard started", { url });

  return {
    url,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
};
