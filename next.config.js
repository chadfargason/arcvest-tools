/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Allow this app to be embedded on arcvest.com
          { 
            key: 'Content-Security-Policy', 
            value: "frame-ancestors 'self' https://arcvest.com https://www.arcvest.com" 
          },
          // Do NOT set X-Frame-Options - CSP frame-ancestors takes precedence
        ],
      },
    ];
  },
}

module.exports = nextConfig
