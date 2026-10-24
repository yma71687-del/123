import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adSchema } from "../../video/schema";

test("built-in example uses the exact media-free parameters of the delivered real sample", () => {
  const example = adSchema.parse(
    JSON.parse(
      readFileSync(
        new URL(
          "../../frontend/public/examples/nexus-motion.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ).project,
  );
  const sample = adSchema.parse(
    JSON.parse(
      readFileSync(
        new URL(
          "../../deliverables/NEXUS-CAPTIONS-SHOWCASE-PROJECT.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ).project,
  );
  assert.deepEqual({ ...example, name: sample.name }, sample);
  assert.equal(example.duration, 15);
  assert.equal(example.captions.cues.length, 3);
  assert.equal(example.music.enabled, true);
  assert.deepEqual(example.imageAssetIds, []);
});
