#!/usr/bin/env node
import { Command } from "commander";
import { DataJam } from "./index";

async function run(): Promise<void> {
  const program = new Command();
  program.name("datajam").description("Local-first Stripe analytics SDK CLI");

  program
    .command("init")
    .description("Initialize datajam in this project")
    .action(async () => {
      const datajam = new DataJam();
      await datajam.init();
      console.info("DataJam initialized.");
    });

  program
    .command("sync")
    .description("Run sync against Stripe")
    .option("--full", "Run full sync")
    .action(async (options: { full?: boolean }) => {
      const datajam = new DataJam();
      const result = await datajam.sync({ full: options.full });
      const fetchedTotal = result.resources.reduce((acc: number, item) => acc + item.fetched, 0);
      console.info(
        `Sync completed: ${result.mode} (${fetchedTotal} records fetched)`
      );
    });

  program
    .command("dashboard")
    .description("Start local dashboard server")
    .option("--port <port>", "Dashboard port", "3210")
    .action(async (options: { port: string }) => {
      const datajam = new DataJam();
      const dashboard = await datajam.dashboard({ port: Number(options.port) });
      console.info(`Dashboard available at ${dashboard.url}`);
    });

  program
    .command("doctor")
    .description("Run local diagnostics")
    .action(async () => {
      const datajam = new DataJam();
      const report = await datajam.doctor();
      const status = report.ok ? "OK" : "FAILED";
      console.info(`Doctor status: ${status}`);
      for (const check of report.checks) {
        console.info(`- [${check.ok ? "ok" : "x"}] ${check.name}: ${check.message}`);
      }
      process.exitCode = report.ok ? 0 : 1;
    });

  await program.parseAsync(process.argv);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
