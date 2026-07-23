/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the workspace root to this repo: stray package-lock.json files in
  // parent directories otherwise make Turbopack infer the wrong root.
  turbopack: {
    root: import.meta.dirname,
  },
}

export default nextConfig
