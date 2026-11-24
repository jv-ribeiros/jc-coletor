import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["node-firebird"],
  devIndicators: false,
  // permite um build de teste separado sem mexer no que está rodando (NEXT_DIST=.next-teste)
  distDir: process.env.NEXT_DIST || ".next",
};

export default nextConfig;
