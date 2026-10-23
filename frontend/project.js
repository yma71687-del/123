// Version 3 compatibility boundary. React/TypeScript migration will consume this contract.
export const TEMPLATES = {
  energy: { color: "#48dcff", fog: 0x07101b, ring: 1.12, distance: 5.8 },
  holo: { color: "#b38aff", fog: 0x10091e, ring: 0.3, distance: 5.8 },
  luxury: { color: "#ffc77d", fog: 0x1a1008, ring: 1.4, distance: 6.6 },
  grid: { color: "#60ffcb", fog: 0x061714, ring: 0, distance: 5.8 },
};
export const uid = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
const list = (value, max, label) => {
  if (!Array.isArray(value) || value.length > max)
    throw Error(`${label}格式无效或数量过多`);
  return value;
};
const numeric = (value, min, max, label) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw Error(`${label}必须在 ${min}–${max} 之间`);
  return value;
};
const color = (value) => {
  if (typeof value !== "string" || !/^#[\da-f]{6}$/i.test(value))
    throw Error("颜色格式无效");
  return value;
};
const isId = (value) =>
  typeof value === "string" && /^[\da-f]{32}$/.test(value);
export function emptyProject() {
  return {
    version: 3,
    name: "NEXUS 科技产品广告",
    duration: 15,
    fps: 30,
    aspect: "16:9",
    template: "energy",
    object: { color: "#48dcff", speed: 1, scale: 1, opacity: 1, ring: 0.8 },
    objects: [],
    keyframes: [],
    audioEvents: [],
    assets: [],
  };
}
export function assetKind(asset) {
  if (asset.contentType?.startsWith("image/")) return "image";
  if (asset.contentType?.startsWith("audio/")) return "audio";
  if (/\.(png|jpe?g|webp|gif|avif)$/i.test(asset.name)) return "image";
  if (/\.(wav|mp3|ogg|m4a|aac|flac)$/i.test(asset.name)) return "audio";
  return "video";
}
export function normalizeProject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("工程必须是 JSON 对象");
  if (input.version !== undefined && input.version !== 3)
    throw Error("仅支持版本 3 工程，请勿覆盖原文件");
  const base = emptyProject(),
    p = { ...base, ...input };
  if (typeof p.name !== "string" || p.name.length > 160)
    throw Error("工程名称不能超过 160 个字符");
  numeric(p.duration, 0.1, 300, "工程时长");
  numeric(p.fps, 1, 60, "帧率");
  if (!["16:9", "2.39:1", "4:3"].includes(p.aspect))
    throw Error("不支持的画幅");
  if (!Object.hasOwn(TEMPLATES, p.template)) throw Error("不支持的视觉预设");
  p.object = { ...base.object, ...input.object };
  color(p.object.color);
  for (const [key, min, max] of [
    ["speed", 0, 3],
    ["scale", 0.4, 2],
    ["opacity", 0.2, 1],
    ["ring", 0, 1],
  ])
    numeric(p.object[key], min, max, key);
  p.assets = list(p.assets, 100, "素材").map((a) => {
    if (!a || !isId(a.id) || typeof a.name !== "string")
      throw Error("素材引用无效");
    return {
      id: a.id,
      name: a.name.slice(0, 200),
      url: "/api/assets/" + a.id,
      contentType: typeof a.contentType === "string" ? a.contentType : "",
      size: a.size || 0,
    };
  });
  if (new Set(p.assets.map((a) => a.id)).size !== p.assets.length)
    throw Error("素材编号重复");
  p.keyframes = list(p.keyframes, 500, "关键帧")
    .map((k) => ({
      t: numeric(k.t, 0, p.duration, "关键帧时间"),
      scale: numeric(k.scale, 0.4, 2, "关键帧尺寸"),
      color: color(k.color),
    }))
    .sort((a, b) => a.t - b.t);
  if (new Set(p.keyframes.map((k) => k.t)).size !== p.keyframes.length)
    throw Error("关键帧时间重复");
  // Legacy snapshots contained only image asset references, not scene object records.
  const rawObjects =
    input.objects === undefined
      ? p.assets
          .filter((a) => assetKind(a) === "image")
          .map((a, i) => ({
            id: a.id,
            kind: "image",
            assetId: a.id,
            x: -1.5 + (i % 3) * 0.35,
            y: -0.15,
            z: 0.25 + i * 0.03,
            width: 1.5,
            height: 1.1,
          }))
      : p.objects;
  p.objects = list(rawObjects, 100, "场景对象").map((o) => {
    if (!o || !isId(o.id) || !["image", "text"].includes(o.kind))
      throw Error("场景对象无效");
    const out = {
      id: o.id,
      kind: o.kind,
      x: numeric(o.x ?? 0, -20, 20, "位置 X"),
      y: numeric(o.y ?? 0, -20, 20, "位置 Y"),
      z: numeric(o.z ?? 0, -20, 20, "位置 Z"),
      width: numeric(o.width ?? 1.5, 0.01, 20, "宽度"),
      height: numeric(o.height ?? 1.1, 0.01, 20, "高度"),
    };
    if (o.kind === "image") {
      if (!p.assets.some((a) => a.id === o.assetId && assetKind(a) === "image"))
        throw Error("图片对象缺少有效素材引用");
      out.assetId = o.assetId;
    } else {
      if (typeof o.text !== "string" || o.text.length > 160)
        throw Error("标题内容无效");
      out.text = o.text;
      out.color = color(o.color || p.object.color);
    }
    return out;
  });
  if (new Set(p.objects.map((o) => o.id)).size !== p.objects.length)
    throw Error("场景对象编号重复");
  p.audioEvents = list(p.audioEvents, 1, "主音效事件").map((e) => {
    const assetId = Object.hasOwn(e, "assetId")
      ? e.assetId
      : p.assets.find((a) => assetKind(a) === "audio")?.id || null;
    if (
      assetId !== null &&
      !p.assets.some((a) => a.id === assetId && assetKind(a) === "audio")
    )
      throw Error("音频事件缺少有效素材引用");
    return {
      assetId,
      time: numeric(e.time, 0, p.duration, "音效时间"),
      volume: numeric(e.volume, 0, 1, "音量"),
    };
  });
  return { ...p, version: 3 };
}
