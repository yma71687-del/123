import { useEffect, useMemo, useState } from "react";
import { Player } from "@remotion/player";
import { AdFilm } from "../../video/AdFilm";
import { defaultAd, type AdProject } from "../../video/schema";
import type { Asset } from "./schema";
import { publicMedia, projectMedia } from "../../video/mediaSource";

export const effects = [
  {
    id: "showcase",
    name: "品牌广告",
    label: "完整三段",
    description: "产品开场 · HUD 数据 · 品牌片尾",
  },
  {
    id: "cloud",
    name: "3D 卡片云",
    label: "可导透明",
    description: "环绕展示 · 深度层次 · 逐张入场",
  },
  {
    id: "hud",
    name: "HUD 数据广告",
    label: "数据动效",
    description: "图表增长 · 数字计数 · 扫描边框",
  },
  {
    id: "grid",
    name: "科技背景／片尾",
    label: "品牌收束",
    description: "透视网格 · 蜂窝流光 · 动态标题",
  },
] as const;
export function EffectLibrary({
  project,
  assets,
  busy,
  onSelect,
  onUpload,
  onImages,
  onReference,
}: {
  project: AdProject;
  assets: Asset[];
  busy: boolean;
  onSelect: (template: AdProject["template"]) => void;
  onUpload: () => void;
  onImages: (ids: string[]) => void;
  onReference: () => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const [reduceMotion, setReduceMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const previews = useMemo(
    () =>
      Object.fromEntries(
        effects.map(({ id }) => [
          id,
          {
            ...structuredClone(defaultAd),
            template: id,
            music: { ...defaultAd.music, enabled: false },
            sfx: [],
          },
        ]),
      ),
    [],
  );
  return (
    <aside className="ad-library panel" aria-label="效果与素材库">
      <div className="ad-section-title">
        <div>
          <span className="ad-kicker">MOTION LIBRARY</span>
          <h2>选择你的画面</h2>
        </div>
        <span className="ad-count">04</span>
      </div>
      <p className="muted">悬停或聚焦试看，点击应用。预览静音。</p>
      <div className="ad-effect-list">
        {effects.map(({ id, name, label, description }, index) => (
          <button
            key={id}
            data-testid={"template-" + id}
            aria-pressed={project.template === id}
            className={
              "ad-effect " + (project.template === id ? "selected" : "")
            }
            onPointerEnter={() => setHover(id)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(id)}
            onBlur={() => setHover(null)}
            onClick={() => onSelect(id)}
          >
            <span className="ad-effect-visual" aria-hidden="true">
              <img
                src={publicMedia("/effects/" + id + ".jpg")}
                alt=""
                loading="lazy"
              />
              {hover === id && !reduceMotion && (
                <span
                  className="ad-effect-motion"
                  data-testid="effect-motion-preview"
                >
                  <Player
                    component={AdFilm}
                    inputProps={{
                      project: previews[id],
                      assetBase: "/api/assets/",
                      resolution: "720p",
                      transparent: false,
                    }}
                    durationInFrames={450}
                    compositionWidth={640}
                    compositionHeight={360}
                    fps={30}
                    initialFrame={45}
                    controls={false}
                    clickToPlay={false}
                    initiallyMuted
                    autoPlay
                    loop
                    style={{ width: "100%" }}
                    acknowledgeRemotionLicense
                  />
                </span>
              )}
              <span className="ad-effect-number">0{index + 1}</span>
              <span className="ad-effect-label">{label}</span>
            </span>
            <span className="ad-effect-text">
              <strong>{name}</strong>
              <small>{description}</small>
            </span>
            <span className="ad-effect-check" aria-hidden="true">
              {project.template === id ? "✓" : "↗"}
            </span>
          </button>
        ))}
      </div>
      <div className="ad-library-assets">
        <div className="timehead">
          <h3>本片素材</h3>
          <span className="ad-count">{project.imageAssetIds.length} / 12</span>
        </div>
        <button className="ad-upload" disabled={busy} onClick={onUpload}>
          ＋ 添加产品图／背景音乐
        </button>
        {project.imageAssetIds.length === 0 ? (
          <p className="muted">可直接使用原创图形，或换成你的产品与 Logo。</p>
        ) : (
          <div className="ad-asset-list">
            {project.imageAssetIds.map((id, index) => (
              <div key={id + index} className="ad-asset">
                <img
                  src={projectMedia("/api/assets/", id)}
                  alt={assets.find((a) => a.id === id)?.name ?? "产品图片"}
                />
                <span title={assets.find((a) => a.id === id)?.name}>
                  {assets.find((a) => a.id === id)?.name ??
                    "产品图 " + (index + 1)}
                </span>
                <button
                  aria-label={"前移图片 " + (index + 1)}
                  disabled={index === 0}
                  onClick={() => {
                    const ids = [...project.imageAssetIds];
                    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
                    onImages(ids);
                  }}
                >
                  ↑
                </button>
                <button
                  aria-label={"移除图片 " + (index + 1)}
                  onClick={() =>
                    onImages(
                      project.imageAssetIds.filter((_, i) => i !== index),
                    )
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <button className="ad-reference-link" onClick={onReference}>
          参考视频解析 <span>↗</span>
        </button>
      </div>
    </aside>
  );
}
