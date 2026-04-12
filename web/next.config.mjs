/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Use Railway internal URL for server-side proxying (no egress, same-origin cookies)
    // Falls back to public URL, then localhost for dev
    const apiUrl = process.env.API_INTERNAL_URL
      || process.env.NEXT_PUBLIC_API_URL
      || 'http://localhost:3001';
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
