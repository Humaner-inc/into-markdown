/** Simple in-memory sliding window for the public convert API. */
const hits = new Map<string, number[]>();

const WINDOW_MS = 60 * 60 * 1000;
const MAX_HITS = 8;

export function checkRateLimit(key: string): {
  ok: boolean;
  retryAfterSec: number;
} {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const prev = hits.get(key) ?? [];
  const recent = prev.filter((t) => t > windowStart);

  if (recent.length >= MAX_HITS) {
    const oldest = recent[0] ?? now;
    const retryAfterSec = Math.max(
      1,
      Math.ceil((oldest + WINDOW_MS - now) / 1000),
    );
    hits.set(key, recent);
    return { ok: false, retryAfterSec };
  }

  recent.push(now);
  hits.set(key, recent);

  // Opportunistic cleanup
  if (hits.size > 5_000) {
    for (const [k, times] of hits) {
      const kept = times.filter((t) => t > windowStart);
      if (kept.length === 0) hits.delete(k);
      else hits.set(k, kept);
    }
  }

  return { ok: true, retryAfterSec: 0 };
}

export function clientKeyFromRequest(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return request.headers.get("x-real-ip") || "unknown";
}
