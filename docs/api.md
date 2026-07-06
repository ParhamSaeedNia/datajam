# DataJam API

```ts
import { DataJam } from "datajam";

const datajam = new DataJam({
  stripeSecretKey: process.env.STRIPE_SECRET_KEY
});

await datajam.sync();
await datajam.dashboard();
```

## Class: `DataJam`

- `init(): Promise<void>`: creates local directories, config snapshot, and DB schema.
- `sync({ full? }): Promise<SyncSummary>`: runs full or incremental Stripe sync.
- `dashboard({ port? }): Promise<{ url; stop() }>`: starts local dashboard server.
- `start(): Promise<{ sync; url; stop() }>`: convenience bootstrap flow.
- `doctor(): Promise<DoctorReport>`: checks local installation health.
