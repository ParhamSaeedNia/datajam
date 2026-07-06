import type { ServerResponse } from "node:http";
import { AnalyticsService } from "@datajam/analytics";
import { SqliteStorageAdapter } from "@datajam/storage-sqlite";

export async function handleOverviewRequest(
  databasePath: string,
  response: ServerResponse
): Promise<void> {
  const storage = new SqliteStorageAdapter({ databasePath });

  try {
    await storage.init();
    const analytics = new AnalyticsService(storage);
    const [metrics, revenueOverTime, topProducts] = await Promise.all([
      analytics.getDashboardMetrics(),
      analytics.getRevenueOverTime(),
      analytics.getTopProducts()
    ]);

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ metrics, revenueOverTime, topProducts }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load dashboard metrics";
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: message }));
  } finally {
    await storage.close();
  }
}
