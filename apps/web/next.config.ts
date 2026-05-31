import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // NOTE: typedRoutes was enabled speculatively in Plan 1, but Lapakgram's
  // dashboard is built around slug-based dynamic routing (`/[merchantSlug]/...`).
  // Nearly every internal link is computed at runtime from a merchant slug,
  // which typedRoutes cannot verify at compile time — it would force an
  // `as Route` cast on every dynamic href, defeating the safety it provides.
  // Disabled to avoid pervasive friction across the dashboard.
  // Workspace package (TS source). Next must transpile + map NodeNext .js
  // re-export specifiers back to .ts source.
  transpilePackages: ["@lapakgram/db"],
  webpack(config) {
    // NodeNext-compliant TS source uses `.js` extensions in relative imports
    // (e.g., `import x from "./foo.js"`). tsc resolves these to `.ts`/`.tsx`
    // source via the resolver. Webpack does not by default. extensionAlias
    // tells webpack to try `.ts` then `.tsx` then `.js` whenever a request
    // ends in `.js`. Required for `apps/web` to import from `packages/db`,
    // and for relative `.js` imports inside `apps/web` itself.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default config;
