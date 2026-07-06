# datajam

Local-first Stripe analytics SDK for Node.js.

## Install

```bash
npm install datajam
```

## Quick start

```ts
import { DataJam } from "datajam";

const datajam = new DataJam({
  stripeSecretKey: process.env.STRIPE_SECRET_KEY
});

await datajam.sync();
await datajam.dashboard(); 
```

## CLI

```bash
npx datajam init
npx datajam sync
npx datajam dashboard
npx datajam doctor
```
