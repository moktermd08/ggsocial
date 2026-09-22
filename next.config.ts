import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * Where the build lands. The deploy builds into .next-new and swaps it in
   * only once the build has succeeded, so the running site keeps serving its
   * old build the whole time and a failed build changes nothing.
   * `next start` gets no override, so it always serves .next.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
