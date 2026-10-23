import type { Caption } from "@remotion/captions";
import { parseSrt } from "@remotion/captions";
import { z } from "zod";

export const captionSchema = z
  .object({
    text: z
      .string()
      .min(1)
      .max(80)
      .refine(
        (text) => text.trim().length > 0 && text.split("\n").length <= 3,
        "字幕需有正文，最多三行",
      ),
    startMs: z.number().int().min(0).max(29900),
    endMs: z.number().int().min(100).max(30000),
    timestampMs: z.number().nonnegative().nullable().default(null),
    confidence: z.number().min(0).max(1).nullable().default(null),
    pageBreakAfter: z.boolean().optional(),
  })
  .strict();

export const captionTrackSchema = z
  .object({
    enabled: z.boolean(),
    style: z.enum(["plain", "tech", "pop"]),
    position: z.enum(["bottom", "top"]),
    fontSize: z.number().int().min(32).max(80),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    cues: z.array(captionSchema).max(50),
  })
  .strict()
  .superRefine((track, ctx) => {
    for (let i = 0; i < track.cues.length; i++) {
      const cue = track.cues[i];
      if (cue.endMs - cue.startMs < 100)
        ctx.addIssue({
          code: "custom",
          path: ["cues", i],
          message: `第 ${i + 1} 条字幕至少持续 0.1 秒`,
        });
      if (i && cue.startMs < track.cues[i - 1].endMs)
        ctx.addIssue({
          code: "custom",
          path: ["cues", i],
          message: `第 ${i + 1} 条字幕与前一条重叠或未按时间排序`,
        });
    }
  });
export type CaptionTrack = z.infer<typeof captionTrackSchema>;
export const defaultCaptionTrack: CaptionTrack = {
  enabled: false,
  style: "tech",
  position: "bottom",
  fontSize: 56,
  color: "#ffffff",
  cues: [],
};

function stamp(ms: number, separator = ",") {
  return `${Math.floor(ms / 3600000)
    .toString()
    .padStart(2, "0")}:${Math.floor((ms / 60000) % 60)
    .toString()
    .padStart(2, "0")}:${Math.floor((ms / 1000) % 60)
    .toString()
    .padStart(2, "0")}${separator}${(ms % 1000).toString().padStart(3, "0")}`;
}
function parseStamp(value: string, vtt: boolean) {
  const match = value.match(
    vtt
      ? /^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})$/
      : /^(\d{2,}):(\d{2}):(\d{2}),(\d{3})$/,
  );
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59)
    throw Error("字幕时间码无效");
  const result =
    (Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3])) *
      1000 +
    Number(match[4]);
  if (!Number.isSafeInteger(result)) throw Error("字幕时间码过大");
  return result;
}
function plainText(text: string) {
  return text
    .replace(
      /<\/?(?:b|i|u|c(?:\.[\w-]+)*|v(?:\s[^>]*)?|lang(?:\s[^>]*)?|ruby|rt)>|<(?:\d{2}:)?\d{2}:\d{2}\.\d{3}>/g,
      "",
    )
    .replace(
      /&(amp|lt|gt|nbsp|lrm|rlm);/g,
      (_, entity: string) =>
        ({ amp: "&", lt: "<", gt: ">", nbsp: " ", lrm: "", rlm: "" })[entity] ??
        "",
    )
    .trim();
}

/** Normalize supported SRT / WebVTT syntax, then use Remotion's JSON parser. */
export function parseSubtitleFile(input: string): Caption[] {
  if (new TextEncoder().encode(input).length > 128 * 1024)
    throw Error("字幕文件超过 128 KiB");
  const normalized = input
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  const vtt = /^WEBVTT(?:\s|$)/.test(normalized);
  const blocks = normalized.split(/\n[ \t]*\n+/);
  if (blocks.length > 2000) throw Error("字幕文件包含过多条目");
  const srt: string[] = [];
  for (let index = 0; index < blocks.length; index++) {
    const lines = blocks[index].split("\n");
    if (
      vtt &&
      (index === 0 || /^(?:NOTE(?:\s|$)|STYLE\s*$|REGION\s*$)/.test(lines[0]))
    )
      continue;
    const timingIndex = lines[0].includes("-->") ? 0 : 1;
    const timing = lines[timingIndex]?.match(
      /^(\S+)\s+-->\s+(\S+)(?:[ \t]+[^\n]*)?$/,
    );
    if (!timing || (!vtt && (timingIndex !== 1 || !/^\d+$/.test(lines[0]))))
      throw Error(`第 ${index + 1} 个字幕块格式无效`);
    const startMs = parseStamp(timing[1], vtt),
      endMs = parseStamp(timing[2], vtt);
    const text = plainText(lines.slice(timingIndex + 1).join("\n"));
    if (endMs <= startMs || !text)
      throw Error(`第 ${index + 1} 个字幕块需有正文且结束晚于开始`);
    srt.push(
      `${srt.length + 1}\n${stamp(startMs)} --> ${stamp(endMs)}\n${text}`,
    );
  }
  if (!srt.length)
    throw Error("未找到有效字幕；需要带时间码的 SRT 或 WebVTT 文件");
  return parseSrt({ input: srt.join("\n\n"), strict: true }).captions.sort(
    (a, b) => a.startMs - b.startMs,
  );
}

export function fitCaptions(
  captions: Caption[],
  sourceStartMs: number,
  durationMs: number,
) {
  if (
    !Number.isInteger(sourceStartMs) ||
    sourceStartMs < 0 ||
    !Number.isInteger(durationMs) ||
    durationMs < 100 ||
    durationMs > 30000
  )
    throw Error("字幕截取范围无效");
  let dropped = 0,
    clipped = 0;
  const cues: Caption[] = [];
  for (const cue of captions) {
    const startMs = Math.max(0, cue.startMs - sourceStartMs),
      endMs = Math.min(durationMs, cue.endMs - sourceStartMs);
    if (endMs - startMs < 100) {
      dropped++;
      continue;
    }
    if (
      startMs !== cue.startMs - sourceStartMs ||
      endMs !== cue.endMs - sourceStartMs
    )
      clipped++;
    cues.push({ ...cue, startMs, endMs, timestampMs: null });
  }
  const checked = captionTrackSchema.safeParse({
    ...defaultCaptionTrack,
    enabled: true,
    cues,
  });
  if (!checked.success)
    throw Error(checked.error.issues.map((issue) => issue.message).join("；"));
  return { cues: checked.data.cues, dropped, clipped };
}
export function serializeSrt(cues: Caption[]) {
  return (
    cues
      .map(
        (cue, i) =>
          `${i + 1}\n${stamp(cue.startMs)} --> ${stamp(cue.endMs)}\n${cue.text}`,
      )
      .join("\n\n") + (cues.length ? "\n" : "")
  );
}
export function captionAtFrame(cues: Caption[], frame: number, fps: number) {
  const timeMs = (frame * 1000) / fps;
  return cues.find((cue) => cue.startMs <= timeMs && timeMs < cue.endMs);
}

/** Conservative em widths keep Chinese and Latin captions in the safe area. */
function captionLines(text: string, limit: number) {
  const result: string[] = [];
  for (const original of text.split("\n")) {
    let line = "",
      used = 0;
    for (const character of original) {
      const width = /[MWmw]/.test(character)
        ? 1
        : character.codePointAt(0)! < 256
          ? 0.72
          : 1;
      if (line && used + width > limit) {
        result.push(line.trimEnd());
        line = "";
        used = 0;
      }
      line += character;
      used += width;
    }
    result.push(line.trimEnd());
  }
  return result;
}
export function captionTextLayout(track: CaptionTrack, text: string) {
  let width = 1440 / track.fontSize;
  let lines = captionLines(text, width);
  while (lines.length > 3 && width < 160) {
    width += 0.5;
    lines = captionLines(text, width);
  }
  const fontSize = Math.min(track.fontSize, Math.floor(1440 / width));
  return {
    lines,
    fontSize,
    height:
      lines.length * fontSize * 1.35 +
      (track.style === "plain" ? 0 : 32) +
      (track.style === "tech" ? 4 : 0),
  };
}
export function captionSafeArea(track: CaptionTrack) {
  if (!track.enabled || !track.cues.length) return { scale: 1, top: 0 };
  const height = Math.min(
    360,
    Math.max(
      ...track.cues.map((cue) => captionTextLayout(track, cue.text).height),
    ),
  );
  const top = track.position === "top" ? 115 + height + 32 : 16;
  const bottom = track.position === "bottom" ? 115 + height + 32 : 80;
  return { scale: Math.min(1, (1080 - top - bottom) / 980), top };
}
