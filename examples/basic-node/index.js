import { DataJam } from "datajam";
import { env, stdout } from "node:process";

const datajam = new DataJam({
  stripeSecretKey: env.STRIPE_SECRET_KEY ?? env.STRIPE_SECRET_KEY_LIVE ?? env.STRIPE_SECRET_KEY_TEST
});

await datajam.init();
await datajam.sync();
const dashboard = await datajam.dashboard();
stdout.write(`Dashboard running at ${dashboard.url}\n`);
