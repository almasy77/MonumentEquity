/**
 * Minimal in-memory stand-in for the Upstash Redis client, covering exactly the
 * commands the app + connector use. Mirrors Upstash's auto-JSON behaviour: values
 * written as JSON strings read back parsed; plain strings read back as strings.
 */
type Entry = { value: string; expiresAt?: number };

export class FakeRedis {
  kv = new Map<string, Entry>();
  sets = new Map<string, Set<string>>();
  zsets = new Map<string, Map<string, number>>();
  /** Every key passed to del(), for "nothing was deleted" assertions. */
  deleted: string[] = [];

  private live(key: string): Entry | undefined {
    const e = this.kv.get(key);
    if (e?.expiresAt !== undefined && e.expiresAt <= Date.now()) {
      this.kv.delete(key);
      return undefined;
    }
    return e;
  }
  private parse(v: string): unknown {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const e = this.live(key);
    return e ? (this.parse(e.value) as T) : null;
  }
  async set(key: string, value: unknown, opts?: { ex?: number }) {
    this.kv.set(key, {
      value: typeof value === "string" ? value : JSON.stringify(value),
      expiresAt: opts?.ex ? Date.now() + opts.ex * 1000 : undefined,
    });
    return "OK";
  }
  async getdel<T = unknown>(key: string): Promise<T | null> {
    const v = await this.get<T>(key);
    this.kv.delete(key);
    return v;
  }
  async del(...keys: string[]) {
    let n = 0;
    for (const k of keys) {
      this.deleted.push(k);
      if (this.kv.delete(k)) n++;
      if (this.sets.delete(k)) n++;
      if (this.zsets.delete(k)) n++;
    }
    return n;
  }
  async expire(key: string, seconds: number) {
    const e = this.live(key);
    if (!e) return 0;
    e.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }
  async sadd(key: string, ...members: string[]) {
    const s = this.sets.get(key) ?? new Set<string>();
    members.forEach((m) => s.add(m));
    this.sets.set(key, s);
    return members.length;
  }
  async srem(key: string, ...members: string[]) {
    const s = this.sets.get(key);
    members.forEach((m) => s?.delete(m));
    return members.length;
  }
  async smembers(key: string) {
    return [...(this.sets.get(key) ?? [])];
  }
  async zadd(key: string, ...args: { score: number; member: string }[]) {
    const z = this.zsets.get(key) ?? new Map<string, number>();
    for (const a of args) z.set(a.member, a.score);
    this.zsets.set(key, z);
    return args.length;
  }
  async zrem(key: string, ...members: string[]) {
    members.forEach((m) => this.zsets.get(key)?.delete(m));
    return members.length;
  }
  async zrange(key: string, start: number, stop: number, opts?: { rev?: boolean }) {
    const z = this.zsets.get(key);
    if (!z) return [] as string[];
    const sorted = [...z.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([m]) => m);
    if (opts?.rev) sorted.reverse();
    return sorted.slice(start, stop === -1 ? undefined : stop + 1);
  }
  async scan(_cursor: string, opts: { match: string }) {
    const re = new RegExp("^" + opts.match.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
    const keys = [...this.kv.keys()].filter((k) => re.test(k) && this.live(k));
    return ["0", keys] as [string, string[]];
  }
  pipeline() {
    const ops: (() => Promise<unknown>)[] = [];
    const get = (key: string) => this.get(key);
    const p = {
      get(key: string) {
        ops.push(() => get(key));
        return p;
      },
      async exec<T>() {
        return (await Promise.all(ops.map((o) => o()))) as T;
      },
    };
    return p;
  }

  clear() {
    this.kv.clear();
    this.sets.clear();
    this.zsets.clear();
    this.deleted = [];
  }
}
