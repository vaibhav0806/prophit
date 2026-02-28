/** @type {import('next').NextConfig} */
const nextConfig = {
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
