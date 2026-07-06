import type { StorageAdapter } from "@datajam/types";

export interface RevenuePoint {
  month: string;
  revenue: number;
  refunds: number;
}

export interface TopProduct {
  productId: string;
  name: string;
  revenue: number;
}

export interface DashboardMetrics {
  revenue: number;
  refunds: number;
  customerCount: number;
  activeSubscriptions: number;
  canceledSubscriptions: number;
  avgOrderValue: number;
  paymentSuccessRate: number;
  mrr: number;
  arr: number;
  monthlyGrowth: number;
  lifetimeValue: number;
}

export class AnalyticsService {
  public constructor(private readonly storage: StorageAdapter) {}

  public async getDashboardMetrics(): Promise<DashboardMetrics> {
    const totals = await this.storage.getAnalyticsPoint(`
      SELECT
        COALESCE(SUM(CASE WHEN json_extract(data_json, '$.paid') = 1 THEN json_extract(data_json, '$.amount') ELSE 0 END), 0) AS revenue_cents,
        COALESCE(SUM(json_extract(data_json, '$.amount_refunded')), 0) AS refunds_cents,
        COUNT(*) AS charge_count
      FROM charges
      WHERE is_deleted = 0
    `);
    const customers = await this.storage.getAnalyticsPoint(
      `SELECT COUNT(*) AS total FROM customers WHERE is_deleted = 0`
    );
    const subscriptions = await this.storage.getAnalyticsPoint(`
      SELECT
        SUM(CASE WHEN json_extract(data_json, '$.status') = 'active' THEN 1 ELSE 0 END) AS active_count,
        SUM(CASE WHEN json_extract(data_json, '$.status') = 'canceled' THEN 1 ELSE 0 END) AS canceled_count
      FROM subscriptions
      WHERE is_deleted = 0
    `);
    const successRates = await this.storage.getAnalyticsPoint(`
      SELECT
        SUM(CASE WHEN json_extract(data_json, '$.status') = 'succeeded' THEN 1 ELSE 0 END) AS succeeded_count,
        COUNT(*) AS total_count
      FROM payment_intents
      WHERE is_deleted = 0
    `);
    const mrr = await this.storage.getAnalyticsPoint(`
      SELECT COALESCE(SUM(CAST(json_extract(p.data_json, '$.unit_amount') AS INTEGER)), 0) AS mrr_cents
      FROM subscriptions s
      JOIN prices p ON json_extract(s.data_json, '$.items.data[0].price.id') = p.stripe_id
      WHERE s.is_deleted = 0
        AND p.is_deleted = 0
        AND json_extract(s.data_json, '$.status') = 'active'
        AND json_extract(p.data_json, '$.recurring.interval') = 'month'
    `);
    const monthlyRevenueRows = await this.getRevenueOverTime();
    const currentMonthRevenue = monthlyRevenueRows.at(-1)?.revenue ?? 0;
    const previousMonthRevenue = monthlyRevenueRows.length > 1 ? monthlyRevenueRows.at(-2)?.revenue ?? 0 : 0;
    const growth =
      previousMonthRevenue > 0
        ? ((currentMonthRevenue - previousMonthRevenue) / previousMonthRevenue) * 100
        : 0;

    const revenue = Number(totals.revenue_cents ?? 0) / 100;
    const refunds = Number(totals.refunds_cents ?? 0) / 100;
    const chargeCount = Number(totals.charge_count ?? 0);
    const customerCount = Number(customers.total ?? 0);

    return {
      revenue,
      refunds,
      customerCount,
      activeSubscriptions: Number(subscriptions.active_count ?? 0),
      canceledSubscriptions: Number(subscriptions.canceled_count ?? 0),
      avgOrderValue: chargeCount > 0 ? revenue / chargeCount : 0,
      paymentSuccessRate:
        Number(successRates.total_count ?? 0) > 0
          ? (Number(successRates.succeeded_count ?? 0) / Number(successRates.total_count ?? 1)) * 100
          : 0,
      mrr: Number(mrr.mrr_cents ?? 0) / 100,
      arr: (Number(mrr.mrr_cents ?? 0) / 100) * 12,
      monthlyGrowth: growth,
      lifetimeValue: customerCount > 0 ? revenue / customerCount : 0
    };
  }

  public async getRevenueOverTime(): Promise<RevenuePoint[]> {
    const rows = await this.storage.getAnalyticsRows(`
      SELECT
        strftime('%Y-%m', datetime(json_extract(data_json, '$.created'), 'unixepoch')) AS month,
        SUM(CASE WHEN json_extract(data_json, '$.paid') = 1 THEN json_extract(data_json, '$.amount') ELSE 0 END) AS revenue_cents,
        SUM(COALESCE(json_extract(data_json, '$.amount_refunded'), 0)) AS refund_cents
      FROM charges
      WHERE is_deleted = 0
      GROUP BY month
      ORDER BY month ASC
    `);
    return rows.map((row) => ({
      month: String(row.month ?? "unknown"),
      revenue: Number(row.revenue_cents ?? 0) / 100,
      refunds: Number(row.refund_cents ?? 0) / 100
    }));
  }

  public async getTopProducts(limit = 5): Promise<TopProduct[]> {
    const rows = await this.storage.getAnalyticsRows(
      `
      SELECT
        p.stripe_id AS product_id,
        COALESCE(json_extract(p.data_json, '$.name'), p.stripe_id) AS product_name,
        SUM(CAST(json_extract(i.data_json, '$.amount_paid') AS INTEGER)) AS revenue_cents
      FROM invoices i
      LEFT JOIN products p ON json_extract(i.data_json, '$.lines.data[0].price.product') = p.stripe_id
      WHERE i.is_deleted = 0
      GROUP BY product_id, product_name
      ORDER BY revenue_cents DESC
      LIMIT ?
    `,
      [limit]
    );

    return rows.map((row) => ({
      productId: String(row.product_id ?? "unknown"),
      name: String(row.product_name ?? "unknown"),
      revenue: Number(row.revenue_cents ?? 0) / 100
    }));
  }
}
