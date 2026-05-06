import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // typedRoutes stays off until A2A route shapes settle.
  },
}

export default nextConfig
