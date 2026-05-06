import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: '.next-build',
  experimental: {
    // typedRoutes stays off until A2A route shapes settle.
  },
}

export default nextConfig
