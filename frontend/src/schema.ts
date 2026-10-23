export const TEMPLATES = {
  energy: {
    name: "能量反应堆",
    color: "#48dcff",
    fog: 0x07101b,
    distance: 6.4,
    description: "同心能量环 · 反应堆 · 径向光柱",
  },
  holo: {
    name: "全息实验室",
    color: "#b38aff",
    fog: 0x10091e,
    distance: 6.4,
    description: "全息线框 · 扫描平面 · 圆形基座",
  },
  luxury: {
    name: "奢品展台",
    color: "#ffc77d",
    fog: 0x1a1008,
    distance: 7.2,
    description: "金属展台 · 门形灯带 · 金色球体",
  },
  grid: {
    name: "数字城市",
    color: "#60ffcb",
    fog: 0x061714,
    distance: 7.2,
    description: "空间网格 · 参数化建筑 · 数字立方体",
  },
} as const;
export type Template = keyof typeof TEMPLATES;
export interface Asset {
  id: string;
  name: string;
  url: string;
  contentType: string;
  size: number;
}
export interface SceneObject {
  id: string;
  kind: "image" | "text" | "primitive";
  name: string;
  assetId?: string;
  text?: string;
  geometry?: "box" | "sphere" | "torus";
  color: string;
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  sx: number;
  sy: number;
  sz: number;
  width: number;
  height: number;
  depth: number;
  opacity: number;
  visible: boolean;
}
export interface Keyframe {
  t: number;
  scale: number;
  color: string;
}
export interface AudioEvent {
  assetId: string | null;
  time: number;
  volume: number;
}
export interface Effect {
  color: string;
  speed: number;
  scale: number;
  opacity: number;
  ring: number;
}
export interface Project {
  version: 4;
  name: string;
  duration: number;
  fps: number;
  aspect: "16:9" | "2.39:1" | "4:3";
  template: Template;
  object: Effect;
  objects: SceneObject[];
  keyframes: Keyframe[];
  audioEvents: AudioEvent[];
  assets: Asset[];
}
export const uid = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
export function emptyProject(): Project {
  return {
    version: 4,
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
export function assetKind(
  asset: Pick<Asset, "name"> & Partial<Asset>,
): "image" | "audio" | "video" {
  if (
    asset.contentType?.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif|avif)$/i.test(asset.name)
  )
    return "image";
  if (
    asset.contentType?.startsWith("audio/") ||
    /\.(wav|mp3|ogg|m4a|aac|flac)$/i.test(asset.name)
  )
    return "audio";
  return "video";
}
type RecordValue = Record<string, unknown>;
const record = (value: unknown, label: string): RecordValue => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error(`${label}必须是 JSON 对象`);
  return value as RecordValue;
};
const list = (value: unknown, max: number, label: string): unknown[] => {
  if (!Array.isArray(value) || value.length > max)
    throw Error(`${label}格式无效或数量过多`);
  return value;
};
const number = (
  value: unknown,
  min: number,
  max: number,
  label: string,
): number => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw Error(`${label}必须在 ${min}–${max} 之间`);
  return value;
};
const string = (value: unknown, max: number, label: string): string => {
  if (typeof value !== "string" || value.length > max)
    throw Error(`${label}格式无效或超过 ${max} 字符`);
  return value;
};
const color = (value: unknown): string => {
  if (typeof value !== "string" || !/^#[\da-f]{6}$/i.test(value))
    throw Error("颜色格式无效");
  return value;
};
const id = (value: unknown): string => {
  if (typeof value !== "string" || !/^[\da-f]{32}$/.test(value))
    throw Error("对象／素材编号无效");
  return value;
};
function unique(items: (string | number)[], label: string) {
  if (new Set(items).size !== items.length) throw Error(`${label}重复`);
}
export function objectDefaults(
  kind: SceneObject["kind"],
  overrides: Partial<SceneObject> = {},
): SceneObject {
  return {
    id: uid(),
    kind,
    name: kind === "text" ? "标题" : kind === "image" ? "图片" : "3D 对象",
    color: "#48dcff",
    x: 0,
    y: 0,
    z: 0.7,
    rx: 0,
    ry: 0,
    rz: 0,
    sx: 1,
    sy: 1,
    sz: 1,
    width: 1,
    height: 1,
    depth: 1,
    opacity: 1,
    visible: true,
    ...overrides,
  };
}
export function normalizeProject(input: unknown): Project {
  const raw = record(input, "工程");
  if (raw.version !== undefined && raw.version !== 3 && raw.version !== 4)
    throw Error("仅支持版本 3／4 工程，请勿覆盖原文件");
  const p = { ...emptyProject(), ...raw };
  const duration = number(p.duration, 0.1, 300, "工程时长");
  if (!["16:9", "2.39:1", "4:3"].includes(String(p.aspect)))
    throw Error("不支持的画幅");
  if (!Object.hasOwn(TEMPLATES, String(p.template)))
    throw Error("不支持的场景");
  const effect = {
    ...emptyProject().object,
    ...record(raw.object ?? {}, "主体参数"),
  };
  const assets = list(p.assets, 100, "素材").map((value) => {
    const a = record(value, "素材"),
      assetId = id(a.id);
    return {
      id: assetId,
      name: string(a.name, 200, "素材名称"),
      url: "/api/assets/" + assetId,
      contentType: string(a.contentType ?? "", 200, "素材类型"),
      size: number(a.size ?? 0, 0, Number.MAX_SAFE_INTEGER, "素材大小"),
    };
  });
  unique(
    assets.map((a) => a.id),
    "素材编号",
  );
  const legacy = assets
    .filter((a) => assetKind(a) === "image")
    .map((a, i) => ({
      id: a.id,
      kind: "image",
      assetId: a.id,
      name: a.name,
      x: -1.5 + (i % 3) * 0.35,
      y: -0.15,
      z: 0.25 + i * 0.03,
      width: 1.5,
      height: 1.1,
    }));
  const objects = list(raw.objects ?? legacy, 100, "场景对象").map((value) => {
    const o = record(value, "场景对象");
    if (!["image", "text", "primitive"].includes(String(o.kind)))
      throw Error("不支持的对象类型");
    const kind = o.kind as SceneObject["kind"];
    const result: SceneObject = {
      id: id(o.id),
      kind,
      name: string(
        o.name ??
          (kind === "text"
            ? (o.text ?? "标题")
            : kind === "image"
              ? "图片"
              : "3D 对象"),
        160,
        "对象名称",
      ),
      color: color(o.color ?? effect.color),
      x: number(o.x ?? 0, -20, 20, "位置 X"),
      y: number(o.y ?? 0, -20, 20, "位置 Y"),
      z: number(o.z ?? 0, -20, 20, "位置 Z"),
      rx: number(o.rx ?? 0, -Math.PI * 20, Math.PI * 20, "旋转 X"),
      ry: number(o.ry ?? 0, -Math.PI * 20, Math.PI * 20, "旋转 Y"),
      rz: number(o.rz ?? 0, -Math.PI * 20, Math.PI * 20, "旋转 Z"),
      sx: number(o.sx ?? 1, 0.05, 10, "缩放 X"),
      sy: number(o.sy ?? 1, 0.05, 10, "缩放 Y"),
      sz: number(o.sz ?? 1, 0.05, 10, "缩放 Z"),
      width: number(o.width ?? 1.5, 0.01, 20, "宽度"),
      height: number(o.height ?? 1.1, 0.01, 20, "高度"),
      depth: number(o.depth ?? 1, 0.01, 20, "深度"),
      opacity: number(o.opacity ?? 1, 0, 1, "透明度"),
      visible: o.visible !== false,
    };
    if (o.visible !== undefined && typeof o.visible !== "boolean")
      throw Error("可见性必须是布尔值");
    if (kind === "image") {
      const assetId = id(o.assetId);
      if (!assets.some((a) => a.id === assetId && assetKind(a) === "image"))
        throw Error("图片对象缺少有效素材引用");
      result.assetId = assetId;
    } else if (kind === "text") result.text = string(o.text, 160, "标题内容");
    else {
      if (!["box", "sphere", "torus"].includes(String(o.geometry)))
        throw Error("不支持的 3D 几何类型");
      result.geometry = o.geometry as SceneObject["geometry"];
    }
    return result;
  });
  unique(
    objects.map((o) => o.id),
    "对象编号",
  );
  const keyframes = list(p.keyframes, 500, "关键帧")
    .map((value) => {
      const k = record(value, "关键帧");
      return {
        t: number(k.t, 0, duration, "关键帧时间"),
        scale: number(k.scale, 0.4, 2, "关键帧尺寸"),
        color: color(k.color),
      };
    })
    .sort((a, b) => a.t - b.t);
  unique(
    keyframes.map((k) => k.t),
    "关键帧时间",
  );
  const audioEvents = list(p.audioEvents, 1, "主音效事件").map((value) => {
    const e = record(value, "音频事件");
    const assetId = Object.hasOwn(e, "assetId")
      ? e.assetId
      : (assets.find((a) => assetKind(a) === "audio")?.id ?? null);
    if (
      assetId !== null &&
      !assets.some((a) => a.id === assetId && assetKind(a) === "audio")
    )
      throw Error("音频事件缺少有效素材引用");
    return {
      assetId: assetId as string | null,
      time: number(e.time ?? 2.5, 0, duration, "音效时间"),
      volume: number(e.volume ?? 0.3, 0, 1, "音量"),
    };
  });
  return {
    ...raw,
    version: 4,
    name: string(p.name, 160, "工程名称"),
    duration,
    fps: number(p.fps, 1, 60, "帧率"),
    aspect: p.aspect as Project["aspect"],
    template: p.template as Template,
    assets,
    objects,
    keyframes,
    audioEvents,
    object: {
      ...effect,
      color: color(effect.color),
      speed: number(effect.speed, 0, 3, "速度"),
      scale: number(effect.scale, 0.4, 2, "尺寸"),
      opacity: number(effect.opacity, 0.2, 1, "透明度"),
      ring: number(effect.ring, 0, 1, "环强度"),
    },
  };
}
