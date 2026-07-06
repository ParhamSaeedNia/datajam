/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@datajam/analytics", "@datajam/storage-sqlite", "@datajam/types"]
};

export default nextConfig;
