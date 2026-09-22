import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * Where the build lands. The deploy builds into .next-new and swaps it in
   * only once the build has succeeded, so the running site keeps serving its
   * old build the whole time and a failed build changes nothing.
   * `next start` gets no override, so it always serves .next.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",

  /*
   * Version skew: a tab left open across a deploy still holds the old build's
   * JavaScript, and its next click would call a Server Action id the new
   * build no longer has ("Failed to find Server Action"). With a deployment
   * id, the client sends it with every request and Next reloads the page on a
   * mismatch instead of failing. The deploy sets it per release; unset (dev,
   * or a build by hand) leaves the behaviour as it was.
   */
  deploymentId: process.env.NEXT_DEPLOYMENT_ID,
};

export default nextConfig;
