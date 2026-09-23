import type { NextConfig } from "next";

/**
 * Frame-protection headers (Spec 5 — Form embed).
 *
 * The public enrollment form (/f/[slug] + its thank-you) is MEANT to be
 * embedded in third-party sites via <iframe>, so it must permit cross-origin
 * framing. Everything else — the admin app (records + PII) and every API
 * route — must NOT be framable (clickjacking defense).
 *
 * X-Frame-Options has no "allow any origin" value (only DENY / SAMEORIGIN), and
 * a present-but-invalid value is treated as DENY by some browsers, so the public
 * form omits XFO entirely and relies on CSP `frame-ancestors *` (which modern
 * browsers honor over XFO where both are present). Source patterns are disjoint,
 * so /f/* never inherits the deny rules.
 */
const denyFraming = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const nextConfig: NextConfig = {
  /**
   * The Deals section was renamed to "Interests" (route /admin/deals →
   * /admin/interest). Redirect the old paths so existing bookmarks/links keep
   * working. Temporary (307) rather than permanent (308) to avoid hard browser
   * caching while the rename settles.
   */
  async redirects() {
    return [
      {
        source: "/admin/deals",
        destination: "/admin/interest",
        permanent: false,
      },
      {
        source: "/admin/deals/:path*",
        destination: "/admin/interest/:path*",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      { source: "/admin/:path*", headers: denyFraming },
      { source: "/api/:path*", headers: denyFraming },
      {
        source: "/f/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
        ],
      },
    ];
  },
};

export default nextConfig;
