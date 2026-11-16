import type { Request, Response, NextFunction } from 'express';

/**
 * Minimal in-memory sliding-window rate limiter (per IP) for mutating endpoints.
 * No external dependency; sufficient for a single-process deployment.
 */

interface Bucket {
  hits: number[];
}

export function rateLimit(opts: { windowMs: number; max: number; keyPrefix: string }) {
  const buckets = new Map<string, Bucket>();

  // Periodic cleanup to avoid unbounded growth.
  setInterval(() => {
    const cutoff = Date.now() - opts.windowMs;
    for (const [k, b] of buckets) {
      b.hits = b.hits.filter((t) => t > cutoff);
      if (b.hits.length === 0) buckets.delete(k);
    }
  }, Math.max(opts.windowMs, 60_000)).unref?.();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${opts.keyPrefix}:${ip}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { hits: [] };
      buckets.set(key, bucket);
    }
    bucket.hits = bucket.hits.filter((t) => t > now - opts.windowMs);
    if (bucket.hits.length >= opts.max) {
      res.status(429).json({
        ok: false,
        error: 'تعداد درخواست‌ها بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید.',
      });
      return;
    }
    bucket.hits.push(now);
    next();
  };
}
