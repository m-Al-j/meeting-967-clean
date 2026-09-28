export class DraftStore {
  constructor(ttlMs = 15 * 60_000) { this.ttlMs = ttlMs; this.map = new Map(); }
  set(key, value) { this.map.set(key, { value, expires: Date.now() + this.ttlMs }); }
  get(key) { const x = this.map.get(key); if (!x || x.expires < Date.now()) { this.map.delete(key); return null; } return x.value; }
  merge(key, patch) { this.set(key, { ...(this.get(key) ?? {}), ...patch }); return this.get(key); }
  delete(key) { this.map.delete(key); }
}
