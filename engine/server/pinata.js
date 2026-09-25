// Token images and metadata on IPFS through Pinata (v3 uploads, public network). A link is
// handed out only after it loads over HTTP from the gateway the token will point at.

const UPLOAD = "https://uploads.pinata.cloud/v3/files";
const TEST = "https://api.pinata.cloud/data/testAuthentication";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Pinata {
  constructor({ jwt, gateway, fetch = globalThis.fetch, tries = 12, waitMs = 5_000 }) {
    Object.assign(this, { jwt, gateway, fetch, tries, waitMs });
  }

  async test() {
    const r = await this.fetch(TEST, { headers: { authorization: `Bearer ${this.jwt}` } });
    if (!r.ok) throw new Error(`Pinata refused the JWT (${r.status})`);
  }

  async upload(bytes, name, type) {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type }), name);
    form.append("network", "public");
    form.append("name", name);
    const r = await this.fetch(UPLOAD, { method: "POST", headers: { authorization: `Bearer ${this.jwt}` }, body: form });
    const body = await r.json().catch(() => null);
    const cid = body?.data?.cid;
    if (!r.ok || !cid) throw new Error(`Pinata upload failed (${r.status})`);
    return cid;
  }

  /** Waits until `url` answers 200; `check(res)` may look at the body. */
  async loads(url, check = async () => true) {
    for (let i = 0; i < this.tries; i++) {
      const r = await this.fetch(url, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
      if (r?.ok && (await check(r).catch(() => false))) return;
      await sleep(this.waitMs);
    }
    throw new Error(`${url} did not load`);
  }

  /** Pins the image, then the metadata JSON pointing at it. Returns { image, uri }. */
  async pinToken({ name, symbol, description, links, image, imageType }) {
    const ext = imageType.split("/")[1];
    const imageUrl = this.gateway + (await this.upload(image, `${symbol}.${ext}`, imageType));
    const json = {
      name,
      symbol,
      description,
      image: imageUrl,
      ...(links.website && { external_url: links.website }),
      ...Object.fromEntries(Object.entries(links).filter(([, v]) => v)),
      createdOn: "Mooner",
    };
    const uri = this.gateway + (await this.upload(Buffer.from(JSON.stringify(json)), `${symbol}.json`, "application/json"));
    await this.loads(uri, async (r) => (await r.json()).name === name);
    return { image: imageUrl, uri };
  }
}

/** Devnet without a JWT: nothing is uploaded; the token points at a placeholder link. */
export class NoPin {
  async test() {}
  async pinToken({ symbol }) {
    return { image: "", uri: `https://example.com/mooner-devnet/${encodeURIComponent(symbol)}.json` };
  }
}
