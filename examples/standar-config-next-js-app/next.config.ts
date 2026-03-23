import { withTailwindStyled } from "tailwind-styled-v4/next"
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: [
    "@tailwind-styled/compiler",
    "@tailwind-styled/scanner",
    "@tailwind-styled/analyzer",
    "@tailwind-styled/engine",
  ],
};
export default withTailwindStyled({
  mode: "runtime",
  scanDirs: ["src"],
  routeCss: true,           // CSS splitting per route (production)
  deadStyleElimination: true,
  staticVariants: true,
  devtools: true,           // DevTools overlay di development
})(nextConfig)
