/**
 * PostHog init for the Vite build of Local.
 *
 * Vite exposes public env vars under `import.meta.env.VITE_*`. To match
 * the family sites (which use Next.js and `NEXT_PUBLIC_*`), both
 * conventions are accepted here — set whichever your host prefers.
 *
 * `defaults: '2026-05-30'` opts into PostHog's May 2026 SDK defaults:
 * autocapture, history-change pageviews, pageleave, and session replay
 * defaults.
 */
import posthog from "posthog-js";

interface ViteEnv {
  VITE_POSTHOG_PROJECT_TOKEN?: string;
  VITE_POSTHOG_HOST?: string;
  NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?: string;
  NEXT_PUBLIC_POSTHOG_HOST?: string;
}

export function initAnalytics(): void {
  if (typeof window === "undefined") return;
  const env = import.meta.env as ViteEnv;
  const token =
    env.VITE_POSTHOG_PROJECT_TOKEN ?? env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  const apiHost =
    env.VITE_POSTHOG_HOST ?? env.NEXT_PUBLIC_POSTHOG_HOST;
  if (token === undefined || token.length === 0) return;
  posthog.init(token, {
    api_host: apiHost ?? "https://us.i.posthog.com",
    defaults: "2026-05-30",
    respect_dnt: true,
  });
}
