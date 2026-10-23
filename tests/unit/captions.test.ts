import test from "node:test";
import assert from "node:assert/strict";
import {
  captionAtFrame,
  defaultCaptionTrack,
  fitCaptions,
  parseSubtitleFile,
  serializeSrt,
  captionTrackSchema,
  captionTextLayout,
  captionSafeArea,
} from "../../video/captions";
import { adSchema, defaultAd } from "../../video/schema";

test("long Chinese captions stay within three lines and reserve top or bottom space", () => {
  const track = {
    ...defaultCaptionTrack,
    enabled: true,
    fontSize: 80,
    cues: [
      {
        text: "字".repeat(80),
        startMs: 0,
        endMs: 3000,
        timestampMs: null,
        confidence: null,
      },
    ],
  };
  const layout = captionTextLayout(track, track.cues[0].text);
  assert.ok(layout.lines.length <= 3);
  assert.ok(
    layout.lines.every((line) => [...line].length * layout.fontSize <= 1440),
  );
  const bottom = captionSafeArea(track);
  assert.ok(bottom.top + bottom.scale * 980 < 1080 - 115 - layout.height);
  const top = captionSafeArea({ ...track, position: "top" });
  assert.ok(top.top > 115 + layout.height);
  assert.deepEqual(captionSafeArea({ ...track, enabled: false }), {
    top: 0,
    scale: 1,
  });
});

test("SRT preserves Chinese multiline captions, CRLF and exact milliseconds", () => {
  const cues = parseSubtitleFile(
    "\uFEFF1\r\n00:00:01,010 --> 00:00:02,010\r\n真实字幕\r\n第二行\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\n结束\r\n",
  );
  assert.equal(cues[0].text, "真实字幕\n第二行");
  assert.equal(cues[0].startMs, 1010);
  assert.equal(cues[0].endMs, 2010);
  assert.deepEqual(parseSubtitleFile(serializeSrt(cues)), cues);
});
test("WebVTT identifiers, note blocks, tags and cue positioning become plain JSON", () => {
  const cues = parseSubtitleFile(
    "WEBVTT\n\nNOTE ignored\nmetadata\n\nintro\n00:01.010 --> 00:02.010 align:start position:10%\n<v Alice><b>科技</b> &amp; <c.red>声音</c>\n\n00:00:03.000 --> 00:00:04.000\n&lt;文字&gt;\n",
  );
  assert.equal(cues[0].text, "科技 & 声音");
  assert.equal(cues[1].text, "<文字>");
  assert.equal(cues[0].startMs, 1010);
});
test("invalid, partial, empty and excessive subtitle inputs are rejected", () => {
  for (const input of [
    "plain text",
    "",
    "1\n00:61:00,000 --> 00:62:00,000\nwrong",
    "1\n00:00:02,000 --> 00:00:01,000\nreverse",
    "1\n00:00:01,000 --> 00:00:02,000\n",
    "WEBVTT\n\nnot a cue",
    "x".repeat(128 * 1024 + 1),
  ]) {
    assert.throws(() => parseSubtitleFile(input));
  }
});
test("a source range reports skipped and clipped captions without modifying source", () => {
  const cues = parseSubtitleFile(
    "1\n00:00:00,000 --> 00:00:01,000\n跳过\n\n2\n00:00:09,000 --> 00:00:12,000\n开头\n\n3\n00:00:13,000 --> 00:00:17,000\n结束\n",
  );
  const original = structuredClone(cues);
  const result = fitCaptions(cues, 10000, 4000);
  assert.equal(result.dropped, 1);
  assert.equal(result.clipped, 2);
  assert.deepEqual(
    result.cues.map((cue) => [cue.startMs, cue.endMs]),
    [
      [0, 2000],
      [3000, 4000],
    ],
  );
  assert.deepEqual(cues, original);
});
test("overlapping, too short and oversized caption tracks never become renderable", () => {
  const cue = {
    text: "安全字幕",
    startMs: 1000,
    endMs: 2000,
    timestampMs: null,
    confidence: null,
  };
  for (const patch of [
    { cues: [cue, { ...cue, startMs: 1500 }] },
    { cues: [{ ...cue, endMs: 1010 }] },
    { cues: [{ ...cue, text: "长".repeat(81) }] },
    { cues: [{ ...cue, text: "a\nb\nc\nd" }] },
    { cues: [{ ...cue, endMs: 30001 }] },
    { color: "url(http://internal/secret)" },
  ])
    assert.equal(
      captionTrackSchema.safeParse({ ...defaultCaptionTrack, ...patch })
        .success,
      false,
    );
});
test("caption visibility starts on the first reachable frame and ends exclusively", () => {
  const cues = parseSubtitleFile(
    "1\n00:00:01,010 --> 00:00:02,010\n精确时间\n",
  );
  assert.equal(captionAtFrame(cues, 30, 30), undefined);
  assert.equal(captionAtFrame(cues, 31, 30)?.text, "精确时间");
  assert.equal(captionAtFrame(cues, 60, 30)?.text, "精确时间");
  assert.equal(captionAtFrame(cues, 61, 30), undefined);
  assert.equal(captionAtFrame(cues, 25, 24)?.text, "精确时间");
});
test("legacy v1 migration adds an empty caption track without changing its input", () => {
  const { captions, ...legacy } = structuredClone(defaultAd);
  const input = { ...legacy, version: 1 };
  const original = structuredClone(input);
  const migrated = adSchema.parse(input);
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.captions, defaultCaptionTrack);
  assert.deepEqual(input, original);
  assert.equal(
    adSchema.safeParse({ ...defaultAd, captions: undefined }).success,
    false,
  );
});
test("subtitle duration and asset security remain enforced in v2 projects", () => {
  const cues = parseSubtitleFile(
    "1\n00:00:01,000 --> 00:00:06,000\n超过时长\n",
  );
  assert.equal(
    adSchema.safeParse({
      ...defaultAd,
      duration: 4,
      sfx: [],
      captions: { ...defaultCaptionTrack, cues },
    }).success,
    false,
  );
  assert.equal(
    adSchema.safeParse({
      ...defaultAd,
      captions: { ...defaultCaptionTrack, externalUrl: "http://internal/" },
    }).success,
    false,
  );
});
