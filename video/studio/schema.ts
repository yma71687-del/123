import { z } from "zod";
import { adSchema, type AdProject } from "../schema";
import { captionTrackSchema, defaultCaptionTrack } from "../captions";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const assetId = z.string().regex(/^[a-f0-9]{32}$/);
export const transformSchema = z
  .object({
    x: z.number().min(-1920).max(1920),
    y: z.number().min(-1080).max(1080),
    scale: z.number().min(0.1).max(3),
    opacity: z.number().min(0).max(1),
  })
  .strict();
export const keyframeSchema = z
  .object({
    property: z.enum(["x", "y", "scale", "opacity"]),
    frame: z.number().int().min(0).max(899),
    value: z.number().finite(),
    easing: z.enum(["linear", "smooth", "hold"]),
  })
  .strict();
export const shotSchema = z
  .object({
    id,
    recipe: z.enum(["hero", "tunnel", "layers", "legacy"]),
    startFrame: z.number().int().min(0).max(899),
    durationFrames: z.number().int().min(1).max(900),
    sourceInFrame: z.number().int().min(0).max(899),
    sourceDurationFrames: z.number().int().min(1).max(900),
    enabled: z.boolean(),
    params: z
      .object({
        brand: z.string().min(1).max(40),
        headline: z.string().min(1).max(32),
        subtitle: z.string().max(100),
        accent: z.string().regex(/^#[a-f0-9]{6}$/i),
        keywords: z.array(z.string().min(1).max(18)).min(1).max(24),
        imageAssetIds: z.array(assetId).max(6),
      })
      .strict(),
    transform: transformSchema,
    keyframes: z.array(keyframeSchema).max(64),
    legacyAd: adSchema.optional(),
  })
  .strict()
  .superRefine((shot, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (shot.sourceInFrame + shot.durationFrames > shot.sourceDurationFrames)
      issue("片段裁入和时长超过源镜头范围");
    if ((shot.recipe === "legacy") !== Boolean(shot.legacyAd))
      issue("旧广告镜头必须包含原工程，其他镜头不能携带旧工程");
    if (
      shot.legacyAd &&
      Math.round(shot.legacyAd.duration * 30) !== shot.sourceDurationFrames
    )
      issue("旧广告镜头的源时长与原工程不一致");
    const seen = new Set<string>();
    for (const key of shot.keyframes) {
      const range = {
        x: [-1920, 1920],
        y: [-1080, 1080],
        scale: [0.1, 3],
        opacity: [0, 1],
      }[key.property];
      if (
        key.frame >= shot.sourceDurationFrames ||
        key.value < range[0] ||
        key.value > range[1]
      )
        issue("关键帧超出源镜头或属性取值范围");
      const pair = key.property + ":" + key.frame;
      if (seen.has(pair)) issue("同一属性同一帧不能有重复关键帧");
      seen.add(pair);
    }
  });
export const audioClipSchema = z
  .object({
    id,
    kind: z.enum(["music", "sfx"]),
    assetId: assetId.nullable(),
    builtin: z.enum(["pulse", "whoosh", "impact", "click"]),
    startFrame: z.number().int().min(0).max(899),
    sourceInFrame: z.number().int().min(0).max(899),
    durationFrames: z.number().int().min(1).max(900),
    gain: z.number().min(0).max(1),
    muted: z.boolean(),
  })
  .strict();
export const studioSchema = z
  .object({
    format: z.literal("nexus-project-ir"),
    version: z.literal(1),
    name: z.string().trim().min(1).max(100),
    fps: z.literal(30),
    width: z.literal(1920),
    height: z.literal(1080),
    durationFrames: z.number().int().min(30).max(900),
    shots: z.array(shotSchema).min(1).max(24),
    audio: z.array(audioClipSchema).max(24),
    captions: captionTrackSchema,
  })
  .strict()
  .superRefine((p, ctx) => {
    const ids = [...p.shots, ...p.audio].map((c) => c.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "镜头与声音编号不能重复" });
    if (
      [...p.shots, ...p.audio].some(
        (c) => c.startFrame + c.durationFrames > p.durationFrames,
      )
    )
      ctx.addIssue({ code: "custom", message: "片段超出工程时长" });
    if (
      p.captions.cues.some((c) => c.endMs > (p.durationFrames / p.fps) * 1000)
    )
      ctx.addIssue({ code: "custom", message: "字幕超出工程时长" });
  });
export type StudioProject = z.infer<typeof studioSchema>;
export type StudioShot = z.infer<typeof shotSchema>;
export type StudioAudio = z.infer<typeof audioClipSchema>;
export type KeyProperty = z.infer<typeof keyframeSchema>["property"];
export const recipes = [
  {
    id: "hero",
    name: "产品主视觉",
    description: "原产品图、柔光舞台、品牌标题",
  },
  {
    id: "tunnel",
    name: "文字纵深隧道",
    description: "ShotCraft 运镜、关键词、品牌收束",
  },
  {
    id: "layers",
    name: "图片图层展示",
    description: "独立图片沿深度展开；不自动拆图",
  },
] as const;
export function newShot(
  recipe: "hero" | "tunnel" | "layers",
  id: string,
  startFrame = 0,
): StudioShot {
  return {
    id,
    recipe,
    startFrame,
    durationFrames: 150,
    sourceInFrame: 0,
    sourceDurationFrames: 150,
    enabled: true,
    params: {
      brand: "NEXUS",
      headline:
        recipe === "hero"
          ? "让产品，成为主角"
          : recipe === "tunnel"
            ? "创意，穿越想象"
            : "每一层，都能被编辑",
      subtitle: "PRODUCT FILM / MOTION SYSTEM",
      accent: "#78e8dc",
      keywords: ["创意", "光影", "设计", "品牌", "声音", "质感"],
      imageAssetIds: [],
    },
    transform: { x: 0, y: 0, scale: 1, opacity: 1 },
    keyframes: [],
  };
}
export function defaultStudio(): StudioProject {
  return {
    format: "nexus-project-ir",
    version: 1,
    name: "NEXUS / 产品宣传片",
    fps: 30,
    width: 1920,
    height: 1080,
    durationFrames: 450,
    shots: [
      newShot("hero", "hero"),
      newShot("tunnel", "tunnel", 150),
      newShot("layers", "layers", 300),
    ],
    audio: [
      {
        id: "music",
        kind: "music",
        assetId: null,
        builtin: "pulse",
        startFrame: 0,
        sourceInFrame: 0,
        durationFrames: 450,
        gain: 0.22,
        muted: false,
      },
      {
        id: "whoosh",
        kind: "sfx",
        assetId: null,
        builtin: "whoosh",
        startFrame: 150,
        sourceInFrame: 0,
        durationFrames: 24,
        gain: 0.4,
        muted: false,
      },
      {
        id: "impact",
        kind: "sfx",
        assetId: null,
        builtin: "impact",
        startFrame: 300,
        sourceInFrame: 0,
        durationFrames: 30,
        gain: 0.35,
        muted: false,
      },
    ],
    captions: structuredClone(defaultCaptionTrack),
  };
}
export function importLegacyAd(input: unknown): StudioProject {
  const ad: AdProject = adSchema.parse(input);
  const p = defaultStudio(),
    durationFrames = Math.round(ad.duration * 30);
  const shot: StudioShot = {
    ...newShot("hero", "legacy"),
    recipe: "legacy",
    durationFrames,
    sourceDurationFrames: durationFrames,
    legacyAd: ad,
  };
  shot.params = {
    ...shot.params,
    brand: ad.name.slice(0, 40),
    headline: ad.headline,
    subtitle: ad.tagline,
    accent: ad.accent,
    imageAssetIds: ad.imageAssetIds.slice(0, 6),
  };
  p.name = ad.name;
  p.durationFrames = durationFrames;
  p.shots = [shot];
  p.captions = ad.captions;
  p.audio = [];
  if (ad.music.enabled)
    p.audio.push({
      id: "legacy-music",
      kind: "music",
      assetId: ad.music.assetId,
      builtin: "pulse",
      startFrame: 0,
      sourceInFrame: 0,
      durationFrames,
      gain: ad.music.gain,
      muted: false,
    });
  ad.sfx.forEach((s, i) => {
    const startFrame = Math.round(s.time * 30);
    if (startFrame < durationFrames)
      p.audio.push({
        id: "legacy-sfx-" + i,
        kind: "sfx",
        assetId: null,
        builtin: s.type,
        startFrame,
        sourceInFrame: 0,
        durationFrames: Math.min(
          s.type === "impact" ? 33 : s.type === "whoosh" ? 26 : 5,
          durationFrames - startFrame,
        ),
        gain: s.gain,
        muted: false,
      });
  });
  return studioSchema.parse(p);
}
export function transformAt(shot: StudioShot, sourceFrame: number) {
  const value = { ...shot.transform };
  for (const property of ["x", "y", "scale", "opacity"] as const) {
    const keys = shot.keyframes
      .filter((k) => k.property === property)
      .sort((a, b) => a.frame - b.frame);
    if (!keys.length) continue;
    if (sourceFrame <= keys[0].frame) {
      value[property] = keys[0].value;
      continue;
    }
    const right = keys.find((k) => k.frame > sourceFrame);
    if (!right) {
      value[property] = keys.at(-1)!.value;
      continue;
    }
    const left = keys[keys.indexOf(right) - 1];
    const t = (sourceFrame - left.frame) / (right.frame - left.frame);
    const u =
      left.easing === "hold"
        ? 0
        : left.easing === "smooth"
          ? t * t * (3 - 2 * t)
          : t;
    value[property] = left.value + (right.value - left.value) * u;
  }
  return value;
}
export function studioAssetIds(p: StudioProject) {
  return {
    images: [
      ...new Set(
        p.shots.flatMap((s) => [
          ...s.params.imageAssetIds,
          ...(s.legacyAd?.imageAssetIds ?? []),
        ]),
      ),
    ],
    audio: [
      ...new Set(
        p.audio.map((a) => a.assetId).filter((a): a is string => Boolean(a)),
      ),
    ],
  };
}
