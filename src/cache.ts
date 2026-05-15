type Entry<T> = { value: T; expiresAt: number };

const DEFAULT_TTL_MS = 60 * 60 * 1000;

export class TtlCache<T> {
  private readonly store = new Map<string, Entry<T>>();
  constructor(private readonly ttlMs: number = DEFAULT_TTL_MS) {}

  get(key: string): T | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (Date.now() > e.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

export function stableKey(parts: unknown[]): string {
  return JSON.stringify(parts);
}
