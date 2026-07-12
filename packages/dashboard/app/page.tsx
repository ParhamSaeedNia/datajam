"use client";

import { useEffect, useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type OverviewResponse = {
  metrics: Record<string, number>;
  revenueOverTime: Array<{ month: string; revenue: number; refunds: number }>;
  topProducts: Array<{ productId: string; name: string; revenue: number }>;
  webAnalytics: {
    summary: Record<string, number>;
    topPages: Array<{ path: string; views: number }>;
    topReferrers: Array<{ referrer: string; views: number }>;
    topEvents: Array<{ eventName: string; count: number }>;
    pageViewsOverTime: Array<{ day: string; views: number }>;
  };
};

const NUMBER_METRICS = [
  "revenue",
  "mrr",
  "arr",
  "monthlyGrowth",
  "refunds",
  "customerCount",
  "activeSubscriptions",
  "canceledSubscriptions",
  "avgOrderValue",
  "lifetimeValue",
  "paymentSuccessRate"
];

const WEB_METRICS = ["pageViews", "visitors", "sessions", "events"];

export default function DashboardPage() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [dark, setDark] = useState(true);

  useEffect(() => {
    fetch("/api/overview")
      .then((response) => response.json())
      .then((json) => setData(json as OverviewResponse))
      .catch(() => setData(null));
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (dark) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [dark]);

  const metricCards = useMemo(() => {
    if (!data) {
      return [];
    }
    return NUMBER_METRICS.map((metric) => ({
      label: metric,
      value: data.metrics[metric] ?? 0
    }));
  }, [data]);

  return (
    <main className="mx-auto max-w-7xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-semibold">DataJam Dashboard</h1>
        <button
          className="rounded-md border border-slate-500 px-3 py-2 text-sm"
          onClick={() => setDark((value: boolean) => !value)}
        >
          Toggle theme
        </button>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {metricCards.map((metric: { label: string; value: number }) => (
          <article key={metric.label} className="rounded-lg border border-slate-700 p-3">
            <h2 className="mb-1 text-xs uppercase opacity-70">{metric.label}</h2>
            <p className="text-lg font-semibold">{metric.value.toFixed(2)}</p>
          </article>
        ))}
      </section>

      <section className="mt-8 rounded-lg border border-slate-700 p-4">
        <h2 className="mb-3 text-lg font-semibold">Revenue Over Time</h2>
        <div className="h-80 w-full">
          <ResponsiveContainer>
            <LineChart data={data?.revenueOverTime ?? []}>
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Line dataKey="revenue" stroke="#3b82f6" />
              <Line dataKey="refunds" stroke="#ef4444" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="mt-8 rounded-lg border border-slate-700 p-4">
        <h2 className="mb-3 text-lg font-semibold">Top Products</h2>
        <div className="space-y-2">
          {(data?.topProducts ?? []).map((item: { productId: string; name: string; revenue: number }) => (
            <div key={item.productId} className="flex items-center justify-between text-sm">
              <span>{item.name}</span>
              <strong>{item.revenue.toFixed(2)}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8 rounded-lg border border-slate-700 p-4">
        <h2 className="mb-3 text-lg font-semibold">Web Analytics</h2>
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {WEB_METRICS.map((metric) => (
            <article key={metric} className="rounded-lg border border-slate-700 p-3">
              <h3 className="mb-1 text-xs uppercase opacity-70">{metric}</h3>
              <p className="text-lg font-semibold">
                {(data?.webAnalytics.summary[metric] ?? 0).toFixed(0)}
              </p>
            </article>
          ))}
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          <WebList
            title="Top Pages"
            rows={(data?.webAnalytics.topPages ?? []).map((item) => ({
              label: item.path,
              value: item.views
            }))}
          />
          <WebList
            title="Top Referrers"
            rows={(data?.webAnalytics.topReferrers ?? []).map((item) => ({
              label: item.referrer,
              value: item.views
            }))}
          />
          <WebList
            title="Top Events"
            rows={(data?.webAnalytics.topEvents ?? []).map((item) => ({
              label: item.eventName,
              value: item.count
            }))}
          />
        </div>
      </section>
    </main>
  );
}

function WebList({ title, rows }: { title: string; rows: Array<{ label: string; value: number }> }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between text-sm">
            <span className="truncate pr-3">{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
