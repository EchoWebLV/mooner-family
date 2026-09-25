// The server's own records, in SQLite (node:sqlite): the mint keys it issued, each tied to
// the wallet it was issued to, the token metadata, and every launch the keeper sent.
// Everything else is read from the chain. The file holds mint secret keys: it is created
// 0600, in a gitignored folder.

import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Keypair } from "@solana/web3.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS mints (
  mint        TEXT PRIMARY KEY,
  secret      BLOB NOT NULL,
  creator     TEXT NOT NULL,
  name        TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  description TEXT NOT NULL,
  links       TEXT NOT NULL,
  image       TEXT NOT NULL,
  uri         TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  presale     TEXT,
  opened_at   INTEGER
);
CREATE INDEX IF NOT EXISTS mints_creator ON mints (creator);
CREATE TABLE IF NOT EXISTS launches (
  presale  TEXT PRIMARY KEY,
  mint     TEXT NOT NULL,
  sig      TEXT NOT NULL,
  released TEXT NOT NULL,
  cost     TEXT NOT NULL,
  tokens   TEXT NOT NULL,
  units    INTEGER NOT NULL,
  at       INTEGER NOT NULL
);`;

const publicToken = (r) =>
  r && {
    mint: r.mint,
    creator: r.creator,
    name: r.name,
    symbol: r.symbol,
    description: r.description,
    links: JSON.parse(r.links),
    image: r.image,
    uri: r.uri,
    createdAt: r.created_at,
    presale: r.presale,
    openedAt: r.opened_at,
  };

export class Store {
  constructor(file) {
    if (file !== ":memory:" && !fs.existsSync(file)) fs.closeSync(fs.openSync(file, "a", 0o600));
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = DELETE;" + SCHEMA);
  }

  close() {
    this.db.close();
  }

  addMint({ mint, creator, name, symbol, description, links, image, uri, now = Date.now() }) {
    this.db
      .prepare("INSERT INTO mints (mint, secret, creator, name, symbol, description, links, image, uri, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(mint.publicKey.toBase58(), Buffer.from(mint.secretKey), creator.toBase58(), name, symbol, description, JSON.stringify(links), image, uri, now);
  }

  /** The mint's key, only for the wallet it was issued to. */
  mintKey(mint, creator) {
    const r = this.db.prepare("SELECT secret FROM mints WHERE mint = ? AND creator = ?").get(mint.toBase58(), creator.toBase58());
    return r ? Keypair.fromSecretKey(new Uint8Array(r.secret)) : undefined;
  }

  /** { name, symbol, uri } for the launch tx. */
  meta(mint) {
    return this.db.prepare("SELECT name, symbol, uri FROM mints WHERE mint = ?").get(mint.toBase58()) ?? undefined;
  }

  token(mint) {
    return publicToken(this.db.prepare("SELECT * FROM mints WHERE mint = ?").get(mint.toBase58()));
  }

  /** Mints issued to `creator` and not yet opened, newest first. */
  unopened(creator) {
    return this.db.prepare("SELECT mint FROM mints WHERE creator = ? AND presale IS NULL ORDER BY created_at DESC").all(creator.toBase58()).map((r) => r.mint);
  }

  /** Every mint not yet opened, any creator. */
  unopenedAll() {
    return this.db.prepare("SELECT mint FROM mints WHERE presale IS NULL").all().map((r) => r.mint);
  }

  /** The tokens `creator` asked for, newest first (public fields only). */
  tokensOf(creator) {
    return this.db.prepare("SELECT * FROM mints WHERE creator = ? ORDER BY created_at DESC").all(creator.toBase58()).map(publicToken);
  }

  markOpened(mint, presale, now = Date.now()) {
    this.db.prepare("UPDATE mints SET presale = ?, opened_at = ? WHERE mint = ? AND presale IS NULL").run(presale.toBase58(), now, mint.toBase58());
  }

  addLaunch(presale, mint, { sig, released, cost, tokens, units }, now = Date.now()) {
    this.db
      .prepare("INSERT OR REPLACE INTO launches (presale, mint, sig, released, cost, tokens, units, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(presale.toBase58(), mint.toBase58(), sig, String(released), String(cost), String(tokens), units, now);
  }

  launch(presale) {
    return this.db.prepare("SELECT sig, released, cost, tokens, units, at FROM launches WHERE presale = ?").get(presale.toBase58()) ?? null;
  }

  /** The token opened as `presale`, for a presale that has closed since. */
  tokenOfPresale(presale) {
    return publicToken(this.db.prepare("SELECT * FROM mints WHERE presale = ?").get(presale.toBase58()));
  }
}
