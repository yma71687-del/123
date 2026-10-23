import { z } from "zod";
import { captionTrackSchema, defaultCaptionTrack } from "./captions";

const currentAdSchema = z
  .object({
    version: z.literal(2),
    name: z.string().min(1).max(100),
    template: z.enum(["showcase", "cloud", "hud", "grid"]),
    headline: z.string().min(1).max(32),
    tagline: z.string().max(72),
    accent: z.string().regex(/^#[0-9a-f]{6}$/i),
    duration: z.number().int().min(4).max(30),
    speed: z.number().min(0.25).max(3),
    radius: z.number().min(0.5).max(1.3),
    labels: z.array(z.string().min(1).max(12)).min(3).max(12),
    imageAssetIds: z.array(z.string().regex(/^[a-f0-9]{32}$/)).max(12),
    values: z.array(z.number().int().min(0).max(10000000)).length(4),
    music: z.object({
      enabled: z.boolean(),
      gain: z.number().min(0).max(1),
      assetId: z
        .string()
        .regex(/^[a-f0-9]{32}$/)
        .nullable(),
    }),
    sfx: z
      .array(
        z.object({
          type: z.enum(["whoosh", "impact", "click"]),
          time: z.number().min(0).max(29.9),
          gain: z.number().min(0).max(1),
        }),
      )
      .max(12),
    captions: captionTrackSchema,
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.sfx.some((e) => e.time >= p.duration))
      ctx.addIssue({ code: "custom", message: "音效开始时间必须小于工程时长" });
    if (p.captions.cues.some((cue) => cue.endMs > p.duration * 1000))
      ctx.addIssue({
        code: "custom",
        path: ["captions"],
        message: "字幕超过工程时长，请调整时间或裁到工程时长",
      });
  });
export const adSchema = z.preprocess((input) => {
  if (
    input &&
    typeof input === "object" &&
    "version" in input &&
    input.version === 1
  )
    return {
      ...input,
      version: 2,
      captions:
        "captions" in input
          ? input.captions
          : structuredClone(defaultCaptionTrack),
    };
  return input;
}, currentAdSchema);
export type AdProject = z.infer<typeof adSchema>;
export const defaultAd: AdProject = {
  version: 2,
  name: "NEXUS / 科技品牌广告",
  template: "showcase",
  headline: "让创意，成为信号",
  tagline: "NEXUS FX STUDIO · MOTION SYSTEM",
  accent: "#64f4d5",
  duration: 15,
  speed: 1,
  radius: 1,
  labels: ["创意", "影像", "品牌", "设计", "声音", "光影", "动效", "未来"],
  imageAssetIds: [],
  values: [36, 58, 74, 96],
  music: { enabled: true, gain: 0.25, assetId: null },
  sfx: [
    { type: "whoosh", time: 0.2, gain: 0.5 },
    { type: "impact", time: 5, gain: 0.45 },
    { type: "whoosh", time: 10, gain: 0.4 },
  ],
  captions: structuredClone(defaultCaptionTrack),
};
export const renderRequestSchema = z
  .object({
    project: adSchema,
    resolution: z.enum(["720p", "1080p"]),
    format: z.enum(["mp4", "webm-alpha", "prores"]),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.format !== "mp4" && p.project.template !== "cloud")
      ctx.addIssue({ code: "custom", message: "透明输出请选择 3D 卡片云模板" });
    if (
      p.format === "prores" &&
      (p.resolution !== "720p" || p.project.duration > 10)
    )
      ctx.addIssue({
        code: "custom",
        message: "ProRes 首批限 720p、10 秒以内，以限制服务器资源占用",
      });
  });
export type AdProps = {
  project: AdProject;
  assetBase: string;
  resolution: "720p" | "1080p";
  transparent: boolean;
};
