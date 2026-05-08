import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for Docker deploys. The runner stage copies
  // only .next-build/standalone + .next-build/static + public; keeps image
  // size to ~200MB instead of dragging the entire node_modules tree.
  output: 'standalone',
  distDir: '.next-build',
  experimental: {
    // typedRoutes stays off until A2A route shapes settle.
  },
}

export default nextConfig
