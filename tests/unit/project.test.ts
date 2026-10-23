import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyProject,
  normalizeProject,
  objectDefaults,
} from "../../frontend/src/schema";
const image = {
  id: "a".repeat(32),
  name: "产品.png",
  url: "https://untrusted.test/a.png",
  contentType: "image/png",
};
test("v3 image references migrate to typed v4 objects without mutating the input", () => {
  const old = {
    version: 3,
    assets: [image],
    metadata: { notes: "保留备注" },
    object: { lightingHint: 0.2 },
  };
  const p = normalizeProject(old);
  assert.equal(p.version, 4);
  assert.equal(p.objects[0].assetId, image.id);
  assert.equal(p.objects[0].sx, 1);
  assert.equal(p.objects[0].visible, true);
  assert.equal(p.assets[0].url, "/api/assets/" + image.id);
  assert.equal(old.version, 3);
  assert.equal(old.assets[0].url, image.url);
  const saved = JSON.parse(JSON.stringify(p));
  assert.deepEqual(saved.metadata, old.metadata);
  assert.equal(saved.object.lightingHint, 0.2);
});
test("reject unsupported versions, invalid transforms and invalid media references", () => {
  for (const invalid of [
    { version: 99 },
    { duration: NaN },
    { object: { scale: 30 } },
    { objects: [objectDefaults("primitive", { geometry: "box", sx: 0 })] },
    { objects: [objectDefaults("text", { text: "品牌", rx: Infinity })] },
    { objects: [objectDefaults("image", { assetId: image.id })] },
    { objects: [objectDefaults("primitive")] },
    { assets: [{ ...image, size: -1 }] },
  ]) {
    assert.throws(() => normalizeProject({ ...emptyProject(), ...invalid }));
  }
});
test("primitive, text, opacity, visibility, audio and ordered keyframes round trip", () => {
  const audio = {
    id: "c".repeat(32),
    name: "cue.wav",
    contentType: "audio/wav",
  };
  const p = normalizeProject({
    ...emptyProject(),
    assets: [audio],
    objects: [
      objectDefaults("primitive", {
        geometry: "torus",
        ry: Math.PI / 2,
        sx: 2,
        opacity: 0.5,
        visible: false,
      }),
      objectDefaults("text", { text: "品牌", color: "#123456" }),
    ],
    audioEvents: [{ assetId: audio.id, time: 2.5, volume: 0.3 }],
    keyframes: [
      { t: 10, scale: 2, color: "#123456" },
      { t: 0, scale: 1, color: "#ffffff" },
    ],
  });
  assert.deepEqual(normalizeProject(JSON.parse(JSON.stringify(p))), p);
  assert.equal(p.objects[0].ry, Math.PI / 2);
  assert.equal(p.objects[0].visible, false);
  assert.deepEqual(
    p.keyframes.map((k) => k.t),
    [0, 10],
  );
});
test("duplicate identities and keyframe times are rejected", () => {
  const key = { t: 2, scale: 1, color: "#ffffff" },
    object = objectDefaults("primitive", { geometry: "box" });
  assert.throws(() =>
    normalizeProject({ ...emptyProject(), keyframes: [key, key] }),
  );
  assert.throws(() =>
    normalizeProject({ ...emptyProject(), objects: [object, object] }),
  );
});
test("explicit audio deselection differs from missing legacy asset ID", () => {
  const audio = { id: "e".repeat(32), name: "cue.wav" };
  assert.equal(
    normalizeProject({
      assets: [audio],
      audioEvents: [{ assetId: null, time: 1, volume: 0.3 }],
    }).audioEvents[0].assetId,
    null,
  );
  assert.equal(
    normalizeProject({
      version: 3,
      assets: [audio],
      audioEvents: [{ time: 1, volume: 0.3 }],
    }).audioEvents[0].assetId,
    audio.id,
  );
});
