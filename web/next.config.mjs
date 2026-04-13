/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // On Railway: API_INTERNAL_URL is set, uses internal networking
    // On Vercel: vercel.json handles rewrites at edge, this is ignored
    if (process.env.API_INTERNAL_URL) {
      return [
        {
          source: '/api/:path*',
          destination: `${process.env.API_INTERNAL_URL}/api/:path*`,
        },
      ];
    }
    return [];
  },
};

export default nextConfig;
