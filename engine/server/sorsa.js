// Sorsa (api.sorsa.io/v3), the X data API the jackpot keeper uses: search, the users who
// reposted a post, and a batch of posts. Read only, one ApiKey header. Every call is one
// request off the key's plan (Starter: 10K a month), so a call past today's budget (UTC)
// throws before it goes out.

const BASE = "https://api.sorsa.io/v3";
const DAY_MS = 86_400_000;

export class Sorsa {
  /** `key`: the ApiKey. `perDay`: requests allowed each UTC day. */
  constructor({ key, perDay = 300, fetch = globalThis.fetch, base = BASE, now = Date.now, timeoutMs = 20_000 }) {
    Object.assign(this, { key, perDay, fetch, base, now, timeoutMs, day: -1, spent: 0 });
  }

  /** Requests left today. */
  left() {
    const day = Math.floor(this.now() / DAY_MS);
    if (day !== this.day) Object.assign(this, { day, spent: 0 });
    return this.perDay - this.spent;
  }

  async post(path, body) {
    if (this.left() <= 0) throw new Error(`sorsa: today's ${this.perDay} requests are spent`);
    this.spent++;
    const r = await this.fetch(`${this.base}${path}`, {
      method: "POST",
      headers: { ApiKey: this.key, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!r.ok) throw new Error(`sorsa ${path}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }

  /** Newest first, 20 a page: { tweets, next_cursor }. `query` is X's advanced search. */
  search(query, cursor = null) {
    return this.post("/search-tweets", { query, order: "latest", ...(cursor && { next_cursor: cursor }) });
  }

  /** The users who reposted the post `id`, newest first: { users, next_cursor }. */
  retweeters(id, cursor = null) {
    return this.post("/retweeters", { tweet_link: String(id), ...(cursor && { next_cursor: cursor }) });
  }

  /** Up to 100 posts by id, with their counts now: { tweets }. */
  tweets(ids) {
    return this.post("/tweet-info-bulk", { tweet_links: ids.map(String) });
  }
}
