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
