// Same cases as the unit tests in programs/presale/src/util.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cutToRoom, failedRefund, feeShare, tokenShare, validSeat } from "../src/math.js";

test("seat sizes: 0.1-1 SOL in 0.01 steps", () => {
  assert.ok(validSeat(100_000_000n));
  assert.ok(validSeat(1_000_000_000n));
  assert.ok(validSeat(550_000_000n));
  assert.ok(!validSeat(90_000_000n));
  assert.ok(!validSeat(1_010_000_000n));
  assert.ok(!validSeat(105_000_000n));
  assert.ok(validSeat(10_000_000n, true), "canary min 0.01");
  assert.ok(validSeat(51_000_000n, true), "canary step 0.001");
});

test("the last commit is cut to the room left", () => {
  assert.equal(cutToRoom(1_000_000_000n, 0n, 9_400_000_000n), 600_000_000n);
  assert.equal(cutToRoom(500_000_000n, 0n, 9_000_000_000n), 500_000_000n);
  assert.equal(cutToRoom(1_000_000_000n, 0n, 10_000_000_000n), null);
  assert.equal(cutToRoom(0n, 300_000_000n, 10_000_000_000n), 0n, "lowering always fits");
  assert.equal(cutToRoom(100_000_000n, 0n, 140_000_000n, true), 60_000_000n, "canary target 0.2");
});

test("fee shares", () => {
  assert.equal(feeShare(1n), 10_000n);
  assert.equal(feeShare(3n), 3_333n);
  assert.equal(feeShare(0n), 10_000n);
});

test("failed refunds never exceed what the presale holds", () => {
  const commits = [1_000_000_000n, 900_000_000n, 330_000_000n, 1_000_000_000n, 450_000_000n, 770_000_000n, 100_000_000n];
  const settledSum = commits.reduce((a, b) => a + b);
  const feesPaid = 7n * 3_333n;
  const held = settledSum - feesPaid;
  const paid = commits.map((c) => failedRefund(c, feesPaid, settledSum)).reduce((a, b) => a + b);
  assert.ok(paid <= held);
  assert.ok(held - paid < BigInt(commits.length));
});

test("token shares sum to the total", () => {
  const commits = [1_000_000_000n, 3_000_000_000n, 6_000_000_000n];
  const total = 123_456_789_012n;
  let claimed = 0n;
  commits.forEach((c, i) => {
    claimed += tokenShare(total, claimed, c, 10_000_000_000n, i === commits.length - 1);
  });
  assert.equal(claimed, total);
});
