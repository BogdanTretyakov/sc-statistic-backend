import { Injectable, Logger } from '@nestjs/common';

interface CacheEntry {
  value: unknown;
  timestamp: number;
}

@Injectable()
export class TaggedMemoryCache {
  private readonly logger = new Logger(TaggedMemoryCache.name);

  private store = new Map<string, CacheEntry>();
  private tagMap = new Map<string, Set<string>>();
  private keyTagMap = new Map<string, Set<string>>();
  private ttl = 60 * 60 * 1000;

  constructor() {
    setInterval(() => this.cleanupExpired(), 10000);
  }

  private cleanupExpired() {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now - entry.timestamp > this.ttl) {
        this.deleteKey(key);
        this.logger.debug(`Removed expired key by TTL: ${key}`);
      }
    }
  }

  private updateTTL(key: string) {
    const entry = this.store.get(key);
    if (entry) {
      entry.timestamp = Date.now();
    }
  }

  set(key: string, value: unknown, tags: string[]) {
    const oldTags = this.keyTagMap.get(key);
    if (oldTags) {
      for (const tag of oldTags) {
        const set = this.tagMap.get(tag);
        set?.delete(key);
        if (set && set.size === 0) this.tagMap.delete(tag);
      }
    }

    this.store.set(key, { value, timestamp: Date.now() });

    if (tags.length) {
      this.keyTagMap.set(key, new Set(tags));
      for (const tag of tags) {
        if (!this.tagMap.has(tag)) this.tagMap.set(tag, new Set());
        this.tagMap.get(tag)!.add(key);
      }
    } else {
      this.keyTagMap.delete(key);
    }
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    this.updateTTL(key);
    return entry.value as T;
  }

  del(key: string) {
    this.deleteKey(key);
  }

  private deleteKey(key: string) {
    this.store.delete(key);
    const tags = this.keyTagMap.get(key);
    if (tags) {
      for (const tag of tags) {
        const set = this.tagMap.get(tag);
        set?.delete(key);
        if (set && set.size === 0) this.tagMap.delete(tag);
      }
      this.keyTagMap.delete(key);
    }
  }

  reset(tags?: string[]) {
    if (!tags) {
      this.store.clear();
      this.tagMap.clear();
      this.keyTagMap.clear();
      return;
    }

    for (const tag of tags) {
      const keys = this.tagMap.get(tag);
      if (!keys) return;

      for (const key of keys) {
        this.store.delete(key);
        this.keyTagMap.get(key)?.delete(tag);
        if (this.keyTagMap.get(key)?.size === 0) this.keyTagMap.delete(key);
      }

      this.tagMap.delete(tag);
    }
  }

  wrap<T>(keyParts: Array<unknown>, fn: () => T, tags: string[]): T {
    if (
      keyParts.some(
        (x) => typeof x === 'object' && x !== null && Object.keys(x).length,
      )
    ) {
      return fn();
    }
    const key = keyParts
      .filter((x) => x === null || typeof x !== 'object')
      .map(String)
      .join(':');
    if (!key) return fn();
    const cached = this.get<Awaited<T>>(key);
    if (cached) return cached;
    const result = fn();
    if (result instanceof Promise) {
      return result.then((r: T) => {
        this.set(key, r, tags);
        return r;
      }) as T;
    }
    this.set(key, result, tags);
    return result;
  }
}
