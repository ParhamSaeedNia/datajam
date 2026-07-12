# datajam

Local-first business and product analytics for Node.js.

DataJam lets developers sync Stripe revenue data, collect first-party website/product events, store everything in local SQLite, and open a built-in dashboard. It is not a SaaS, has no cloud account, and does not send your data to DataJam servers.

> Backend-first package with an optional tiny browser tracker via `datajam/browser`.

[![npm version](https://img.shields.io/npm/v/datajam.svg)](https://www.npmjs.com/package/datajam)
[![license](https://img.shields.io/npm/l/datajam.svg)](https://www.npmjs.com/package/datajam)

## Why DataJam?

Stripe tells you what happened financially. Product analytics tells you what users did before that. DataJam brings those two worlds into one local database so you can answer questions like:

- Which pages are visited most?
- Which buttons are clicked most?
- Where are users coming from?
- Which landing pages or campaigns drive customers?
- How do product events connect to Stripe revenue?

Everything runs in your own Node.js project and writes to `.datajam/datajam.db`.

## Features

- Stripe sync into local SQLite
- First-party page view, click, and custom event tracking
- Anonymous visitor and session IDs
- Referrer and UTM source capture
- Local dashboard for revenue and web analytics
- CLI for init, sync, dashboard, and doctor
- TypeScript SDK
- No hosted service, no login, no external analytics vendor

## Requirements

- Node.js `>=20`
- Stripe secret key for revenue sync
- A Node.js backend if you want browser event ingestion

## Install

```bash
npm install datajam
```

## Quick Start: Stripe + Dashboard

```ts
import { DataJam } from "datajam";

const datajam = new DataJam({
  stripeSecretKey: process.env.STRIPE_SECRET_KEY
});

await datajam.init();
await datajam.sync({ full: true }); // first run

const dashboard = await datajam.dashboard();
console.log(`Dashboard running at ${dashboard.url}`);
```

Open:

```text
http://127.0.0.1:3210
```

Later syncs can be incremental:

```ts
await datajam.sync();
```

## First-Party Web Tracking

DataJam can collect GA-like analytics by itself. You add DataJam to your backend, then add the browser tracker to your frontend.

### Backend

Mount the ingestion middleware in your Node.js app:

```ts
import express from "express";
import { DataJam } from "datajam";

const app = express();

const datajam = new DataJam({
  stripeSecretKey: process.env.STRIPE_SECRET_KEY
});

app.use("/datajam", datajam.middleware());

app.listen(3000);
```

The middleware accepts tracking events at:

```text
POST /datajam/events
POST /datajam/track
POST /datajam
```

### Frontend

Use the browser-only entrypoint:

```ts
import { initDataJam, track } from "datajam/browser";

initDataJam({
  endpoint: "/datajam/events"
});

track("signup_started", {
  plan: "premium"
});
```

This tracks page views automatically by default.

### Click Tracking

DataJam tracks marked clicks by default. This avoids collecting noisy or sensitive click data.

```html
<button data-dj-click="checkout_cta">Start trial</button>
```

or:

```html
<button data-datajam-event="pricing_cta_clicked">Start trial</button>
```

## What Gets Stored

DataJam creates a local folder in your project:

```text
.datajam/
  datajam.db
  config.json
  logs/
  cache/
```

Stripe data:

- Customers
- Products
- Prices
- Subscriptions
- Invoices
- Charges
- Refunds
- Payment Intents
- Checkout Sessions
- Balance Transactions
- Disputes
- Payouts
- Transfers

Web analytics data:

- Visitors
- Sessions
- Page views
- Events
- Marked clicks
- Referrers
- UTM source, medium, and campaign

## Dashboard Metrics

Revenue analytics:

- Revenue
- MRR
- ARR
- Monthly growth
- Refunds
- Customers
- Active and canceled subscriptions
- Average order value
- Lifetime value
- Payment success rate
- Revenue over time
- Top products

Web analytics:

- Page views
- Visitors
- Sessions
- Events
- Top pages
- Top referrers
- Top events and button clicks

## CLI

```bash
npx datajam init
npx datajam sync
npx datajam sync --full
npx datajam dashboard
npx datajam dashboard --port 4000
npx datajam doctor
```

## Configuration

`npx datajam init` creates `datajam.config.ts`:

```ts
export default {
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
```

Config precedence:

1. `new DataJam({ ... })`
2. `datajam.config.ts`
3. environment variables
4. defaults

## Public API

```ts
const datajam = new DataJam(options);

await datajam.init();
await datajam.sync({ full?: boolean });
await datajam.dashboard({ port?: number });
await datajam.start();
await datajam.doctor();

app.use("/datajam", datajam.middleware());
await datajam.track(event);
```

Browser API:

```ts
import { initDataJam, track, trackPageView } from "datajam/browser";
```

## Where To Install It

Install `datajam` in your backend/server project.

Use:

```ts
import { DataJam } from "datajam";
```

only on the server.

Use:

```ts
import { initDataJam, track } from "datajam/browser";
```

only in the browser.

Do not import `DataJam` in frontend/client bundles because it uses Node.js APIs, SQLite, and Stripe secrets.

## Privacy Notes

DataJam is local-first and privacy-conscious by default:

- No DataJam cloud
- No external analytics service
- No form field tracking
- No DOM/session recording
- Click tracking is marked-only by default
- Sensitive query params such as `token`, `secret`, `password`, `email`, `code`, and `session` are redacted in tracked URLs

You are responsible for how you disclose analytics tracking to your users.

## Security Notes

- Keep Stripe secret keys server-side only
- Never commit `.env` or `.datajam/`
- `.datajam/datajam.db` contains business and analytics data
- The dashboard has no authentication and is intended for local/internal use

## Troubleshooting

Run diagnostics:

```bash
npx datajam doctor
```

Common fixes:

- Missing Stripe key: set `STRIPE_SECRET_KEY`
- Empty dashboard after install: run `npx datajam sync --full`
- Dashboard port in use: run `npx datajam dashboard --port 4000`
- Browser tracking not appearing: confirm your backend mounted `datajam.middleware()` at the same endpoint used by `initDataJam()`

## Status

DataJam is early-stage. The first production path is Stripe sync plus local web analytics. The architecture is designed to grow into additional connectors and deeper revenue attribution.

## License

MIT
