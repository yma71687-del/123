import test from "node:test";
import assert from "node:assert/strict";
import { adSchema, defaultAd, renderRequestSchema } from "../../video/schema";

test("advertising inputs cannot introduce remote media URLs or render host options", () => {
  assert.equal(
    adSchema.safeParse({
      ...defaultAd,
      imageAssetIds: ["http://169.254.169.254/metadata"],
    }).success,
    false,
  );
  assert.equal(
    adSchema.safeParse({
      ...defaultAd,
      music: { ...defaultAd.music, assetId: "../../private" },
    }).success,
    false,
  );
  assert.equal(
    renderRequestSchema.safeParse({
      project: defaultAd,
      resolution: "720p",
      format: "mp4",
      assetBase: "http://internal/",
    }).success,
    false,
  );
});
test("audio cues and export settings enforce actual timeline and resource boundaries", () => {
  assert.equal(
    adSchema.safeParse({ ...defaultAd, duration: 4 }).success,
    false,
  );
  assert.equal(
    adSchema.safeParse({
      ...defaultAd,
      duration: 4,
      sfx: [{ type: "click", time: 0, gain: 0 }],
    }).success,
    true,
  );
  assert.equal(
    renderRequestSchema.safeParse({
      project: defaultAd,
      resolution: "720p",
      format: "webm-alpha",
    }).success,
    false,
  );
  const project = { ...defaultAd, template: "cloud", duration: 4, sfx: [] };
  assert.equal(
    renderRequestSchema.safeParse({
      project,
      resolution: "720p",
      format: "prores",
    }).success,
    true,
  );
  assert.equal(
    renderRequestSchema.safeParse({
      project,
      resolution: "1080p",
      format: "prores",
    }).success,
    false,
  );
});
