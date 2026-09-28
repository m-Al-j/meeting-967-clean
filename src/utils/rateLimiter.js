import { AppError } from '../core/errors/AppError.js';
export class RateLimiter {
  constructor() { this.hits = new Map(); }
  consume(key, { limit = 5, windowMs = 10_000 } = {}) {
    const now = Date.now();
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (arr.length >= limit) throw new AppError('RATE_LIMITED', 'محاولات كثيرة بسرعة. انتظر قليلًا ثم حاول مجددًا.');
    arr.push(now); this.hits.set(key, arr); return true;
  }
}
