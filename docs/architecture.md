# DataJam Architecture

DataJam is a local-first Node.js SDK that syncs Stripe data into a project-local SQLite database and serves a local dashboard.

## Packages

- `datajam`: public SDK package and CLI entrypoint.
- `@datajam/core`: orchestration, config resolution, retries, sync lifecycle.
- `@datajam/types`: shared interfaces and public DTOs.
- `@datajam/storage-sqlite`: SQLite adapter implementation.
- `@datajam/connector-stripe`: Stripe connector.
- `@datajam/analytics`: analytics query service.
- `@datajam/dashboard`: local Next.js dashboard server.
- `@datajam/cli`: reusable CLI metadata module.

## Runtime Flow

1. `DataJam` resolves config (`options -> datajam.config.ts -> env -> defaults`).
2. `.datajam/` directory is bootstrapped.
3. Sync run starts and checkpoints are loaded.
4. Stripe pages stream through connector.
5. Raw object + normalized object are upserted to SQLite.
6. Checkpoints are updated after page persistence.
7. Dashboard reads analytics from local SQLite.
