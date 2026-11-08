import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  defaultStudio,
  studioSchema,
  transformAt,
  importLegacyAd,
} from "../../video/studio/schema";
import { defaultAd } from "../../video/schema";
import { StudioHistory, splitShot } from "../../frontend/src/studio/edit";
import { StudioStore } from "../../render-worker/studioStore";

test("studio JSON rejects remote asset URLs, duplicate IDs, unsupported keys and invalid timelines", () => {
  const p = defaultStudio();
  assert.equal(studioSchema.safeParse(p).success, true);
  const invalid = structuredClone(p);
  invalid.shots[0].params.imageAssetIds = ["http://169.254.169.254/latest"];
  assert.equal(studioSchema.safeParse(invalid).success, false);
  assert.equal(
    studioSchema.safeParse({ ...p, renderHost: "http://internal" }).success,
    false,
  );
  assert.equal(
    studioSchema.safeParse({ ...p, durationFrames: 100 }).success,
    false,
  );
  invalid.shots[0].params.imageAssetIds = [];
  invalid.shots[1].id = invalid.shots[0].id;
  assert.equal(studioSchema.safeParse(invalid).success, false);
  invalid.shots[1].id = "different";
  invalid.shots[0].sourceInFrame = 100;
  assert.equal(studioSchema.safeParse(invalid).success, false);
});
test("keyframe interpolation clamps, honors hold, rejects duplicate keys and unsafe transform ranges", () => {
  const p = defaultStudio(),
    s = p.shots[0];
  s.keyframes = [
    { property: "x", frame: 10, value: 0, easing: "linear" },
    { property: "x", frame: 110, value: 200, easing: "linear" },
  ];
  assert.equal(transformAt(s, 0).x, 0);
  assert.equal(transformAt(s, 60).x, 100);
  assert.equal(transformAt(s, 140).x, 200);
  s.keyframes[0].easing = "hold";
  assert.equal(transformAt(s, 60).x, 0);
  assert.equal(transformAt(s, 110).x, 200);
  s.keyframes.push({ ...s.keyframes[0] });
  assert.equal(studioSchema.safeParse(p).success, false);
  s.keyframes = [{ property: "opacity", frame: 0, value: 2, easing: "linear" }];
  assert.equal(studioSchema.safeParse(p).success, false);
});
test("split preserves exact source frames and keyframe values; undo restores entire edit", () => {
  const p = defaultStudio();
  p.shots[0].keyframes = [
    { property: "scale", frame: 0, value: 1, easing: "linear" },
    { property: "scale", frame: 149, value: 2, easing: "linear" },
  ];
  const h = new StudioHistory(p);
  const before = structuredClone(p.shots[0]);
  h.commit((p) => splitShot(p, "hero", 60, "right"));
  const right = h.current.shots[1];
  assert.equal(right.sourceInFrame, 60);
  assert.equal(right.durationFrames, 90);
  for (let f = 60; f < 150; f++)
    assert.deepEqual(
      transformAt(before, f),
      transformAt(right, right.sourceInFrame + f - right.startFrame),
    );
  assert.equal(h.current.shots[0].durationFrames + right.durationFrames, 150);
  h.undo();
  assert.deepEqual(h.current, p);
  h.redo();
  assert.equal(h.current.shots.length, 4);
  assert.throws(() => h.commit((p) => splitShot(p, "hero", 0, "invalid")));
});
test("legacy import keeps original data intact and moves audio and captions into independent tracks", () => {
  const original = structuredClone(defaultAd),
    copy = structuredClone(original);
  original.imageAssetIds = ["a".repeat(32)];
  const p = importLegacyAd(original);
  assert.equal(p.shots[0].recipe, "legacy");
  assert.deepEqual(p.shots[0].legacyAd, original);
  assert.deepEqual(
    p.audio.filter((a) => a.kind === "sfx").map((a) => a.startFrame),
    [6, 150, 300],
  );
  assert.equal(p.audio[0].gain, copy.music.gain);
  assert.equal(original.version, 2);
});
test("project revisions survive restart, reject stale concurrent saves and preserve damaged head", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexus-studio-store-"));
  try {
    const store = new StudioStore(dir),
      p = defaultStudio();
    const first = await store.save(p);
    assert.equal(first.revision, 1);
    const updates = await Promise.allSettled([
      store.save({ ...p, name: "first" }, first.id, 1),
      store.save({ ...p, name: "second" }, first.id, 1),
    ]);
    assert.equal(updates.filter((v) => v.status === "fulfilled").length, 1);
    const reopened = new StudioStore(dir);
    assert.equal((await reopened.get(first.id)).revision, 2);
    assert.equal((await reopened.get(first.id, 1)).project.name, p.name);
    assert.deepEqual((await reopened.versions(first.id)).versions, [2, 1]);
    await writeFile(join(dir, first.id, "head.json"), "broken");
    await assert.rejects(reopened.save(p, first.id, 2), /拒绝覆盖/);
    assert.equal(
      await readFile(join(dir, first.id, "head.json"), "utf8"),
      "broken",
    );
    await assert.rejects(reopened.get("../private"), /不存在/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
