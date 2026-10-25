import { useEffect, useState, type RefObject } from "react";
import type { PlayerRef } from "@remotion/player";
import type { AdProject } from "../../video/schema";
import { publicMedia } from "../../video/mediaSource";

export function SequenceOverview({
  project,
  player,
  onEdit,
}: {
  project: AdProject;
  player: RefObject<PlayerRef | null>;
  onEdit: (view: "captions" | "audio") => void;
}) {
  const [frame, setFrame] = useState(45);
  useEffect(() => {
    const current = player.current;
    if (!current) return;
    const update = (event: { detail: { frame: number } }) =>
      setFrame(event.detail.frame);
    current.addEventListener("frameupdate", update);
    setFrame(current.getCurrentFrame());
    return () => current.removeEventListener("frameupdate", update);
  }, [player]);
  const frames = Math.round(project.duration * 30);
  const a = Math.round(frames / 3),
    b = Math.round((frames * 2) / 3);
  const scenes =
    project.template === "showcase"
      ? [
          {
            name: "产品开场",
            effect: "环绕卡片与品牌标题",
            from: 0,
            to: a,
            image: "showcase",
          },
          {
            name: "数据展示",
            effect: "HUD 图表与动态计数",
            from: a,
            to: b,
            image: "hud",
          },
          {
            name: "品牌片尾",
            effect: "科技网格与品牌收束",
            from: b,
            to: frames,
            image: "grid",
          },
        ]
      : [
          {
            name: (
              {
                cloud: "环绕产品",
                hud: "HUD 数据",
                grid: "科技片尾",
              } as Record<string, string>
            )[project.template],
            effect: "当前模板贯穿整个片段",
            from: 0,
            to: frames,
            image: project.template,
          },
        ];
  return (
    <section className="ad-storyboard" aria-label="分镜导航">
      <div className="timehead">
        <div>
          <h2>这条广告如何展开</h2>
          <span className="muted">
            点击片段定位画面；片段结构由当前模板决定。
          </span>
        </div>
        <output data-testid="storyboard-time">
          {(frame / 30).toFixed(1)}s / {project.duration}s
        </output>
      </div>
      <div className="ad-scenes">
        {scenes.map((scene, index) => (
          <button
            key={scene.name}
            data-testid={"scene-" + index}
            className={frame >= scene.from && frame < scene.to ? "current" : ""}
            aria-label={"定位片段 " + scene.name}
            onClick={() => {
              player.current?.pause();
              player.current?.seekTo(scene.from);
            }}
          >
            <img src={publicMedia("/effects/" + scene.image + ".jpg")} alt="" />
            <span>
              <small>
                0{index + 1} / {(scene.from / 30).toFixed(1)}–
                {(scene.to / 30).toFixed(1)}s
              </small>
              <strong>{scene.name}</strong>
              <small>{scene.effect}</small>
            </span>
          </button>
        ))}
      </div>
      <div className="ad-track-summary">
        <button onClick={() => onEdit("captions")}>
          字幕轨{" "}
          <strong>
            {project.captions.enabled
              ? project.captions.cues.length + " 条"
              : "已关闭"}
          </strong>
        </button>
        <button onClick={() => onEdit("audio")}>
          背景音乐{" "}
          <strong>
            {project.music.enabled
              ? Math.round(project.music.gain * 100) + "%"
              : "已关闭"}
          </strong>
        </button>
        <button onClick={() => onEdit("audio")}>
          独立音效 <strong>{project.sfx.length} 条</strong>
        </button>
      </div>
    </section>
  );
}
