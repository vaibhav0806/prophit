/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'locales.probable.markets' },
      { protocol: 'https', hostname: 'images.opinion.trade' },
      { protocol: 'https', hostname: '*.predict.fun' },
      { protocol: 'https', hostname: 'predict.fun' },
    ],
  },
}

export default nextConfig
