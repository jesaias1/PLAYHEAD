import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

/**
 * Build identifier.
 *
 * Injected at build time so a deployed bundle can always be traced back to the
 * exact commit it was built from. Never hardcoded: if git is unavailable (or
 * the checkout has no history) it falls back to the literal string "DEV".
 */
function resolveBuildSha(): string {
  // Vercel exposes the commit SHA directly; prefer it when present.
  const fromEnv =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.COMMIT_REF;
  if (fromEnv && typeof fromEnv === 'string') {
    return fromEnv.slice(0, 7);
  }
  try {
    const sha = execSync('git rev-parse --short=7 HEAD', {
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .toString()
      .trim();
    return sha || 'DEV';
  } catch {
    return 'DEV';
  }
}

const buildSha = resolveBuildSha();

export default defineConfig({
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha)
  },
  server: {
    port: 3000,
    open: false
  },
  build: {
    target: 'esnext'
  }
});