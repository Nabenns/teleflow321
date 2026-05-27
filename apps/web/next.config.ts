import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // typedRoutes graduated out of experimental in Next 15.x; use top-level.
  typedRoutes: true,
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
