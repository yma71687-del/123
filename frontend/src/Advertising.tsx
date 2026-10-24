import { useEffect, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { AdFilm } from "../../video/AdFilm";
import {
  adSchema,
  defaultAd,
  renderRequestSchema,
  type AdProject,
} from "../../video/schema";
import { api, download } from "./io";
import type { Asset } from "./schema";
import "./advertising.css";
import { ReferenceAnalysis } from "./ReferenceAnalysis";
import { CaptionEditor, type CaptionImport } from "./CaptionEditor";

type Job = {
  id: string;
  name: string;
  status: string;
  progress: number;
  format: string;
  resolution: string;
  error?: string;
  downloadUrl: string | null;
  elapsedSeconds?: number;
};
const templates = [
  ["showcase", "品牌广告", "卡片开场 → HUD 数据 → 品牌片尾"],
  ["cloud", "3D 卡片云", "环绕、深度层次、逐张入场与透明素材"],
  ["hud", "HUD 数据广告", "图表增长、数字计数与科技边框"],
  ["grid", "科技背景／片尾", "蜂窝、透视网格、流光与动态标题"],
] as const;
const draftKey = "nexus-ad-draft-v1";
const exampleBackupKey = "nexus-ad-before-example-v2";
type ExampleBackup = {
  project: AdProject;
  format: "mp4" | "webm-alpha" | "prores";
  resolution: "720p" | "1080p";
};
export function Advertising() {
  const [project, setProject] = useState<AdProject>(structuredClone(defaultAd));
  const [status, setStatus] = useState("正在读取广告工程…");
  const [error, setError] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resolution, setResolution] = useState<"720p" | "1080p">("1080p");
  const [format, setFormat] = useState<"mp4" | "webm-alpha" | "prores">("mp4");
  const [batchTitles, setBatchTitles] = useState("");
  const [captionImport, setCaptionImport] = useState<CaptionImport | null>(
    null,
  );
  const [canRestoreExample, setCanRestoreExample] = useState(() => {
    try {
      return !!localStorage.getItem(exampleBackupKey);
    } catch {
      return false;
    }
  });
  const exampleBackup = useRef<ExampleBackup | null>(null);
  const valid = adSchema.safeParse(project).success;
  const player = useRef<PlayerRef>(null);
  const file = useRef<HTMLInputElement>(null);
  const media = useRef<HTMLInputElement>(null);
  const dirty = useRef(false);
  const note = (text: string, err = false) => {
    setStatus(text);
    setError(err);
  };
  const patch = (change: Partial<AdProject>) => {
    player.current?.pause();
    dirty.current = true;
    setProject((p) => ({ ...p, ...change }));
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      note(e instanceof Error ? e.message : String(e), true);
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () =>
    setJobs((await api<{ jobs: Job[] }>("/api/advertising/jobs")).jobs);
  const loadExample = () =>
    run(async () => {
      const data = await api<{ project: unknown }>(
        "/examples/nexus-motion.json",
      );
      const example = adSchema.parse(data.project);
      if (JSON.stringify(example) === JSON.stringify(project)) {
        note("当前已经是示范工程，可直接播放或渲染。");
        return;
      }
      const backup = { project: adSchema.parse(project), format, resolution };
      exampleBackup.current = structuredClone(backup);
      let durable = true;
      try {
        localStorage.setItem(exampleBackupKey, JSON.stringify(backup));
      } catch {
        durable = false;
      }
      setCanRestoreExample(true);
      patch(example);
      setFormat("mp4");
      setResolution("1080p");
      note(
        (ready
          ? "已载入 15 秒带声字幕示范工程，可播放、修改和渲染；点击保存才会同步云端。"
          : "示范工程可先预览；云端渲染服务尚未连接。") +
          (durable
            ? " 载入前参数已备份。"
            : " 载入前参数仅暂存在当前页面，请保持页面打开。"),
        !ready || !durable,
      );
    });
  const restoreExample = () =>
    run(async () => {
      const raw =
        exampleBackup.current ??
        JSON.parse(localStorage.getItem(exampleBackupKey) ?? "null");
      if (!raw) throw Error("没有载入前的工程备份");
      const previous = adSchema.parse(raw.project);
      patch(previous);
      setFormat(
        ["mp4", "webm-alpha", "prores"].includes(raw.format)
          ? raw.format
          : "mp4",
      );
      setResolution(raw.resolution === "720p" ? "720p" : "1080p");
      exampleBackup.current = null;
      try {
        localStorage.removeItem(exampleBackupKey);
      } catch {
        /* The private memory copy was restored. */
      }
      setCanRestoreExample(false);
      note("已恢复最近一次载入前的工程参数，尚未同步云端。");
    });
  useEffect(() => {
    let disposed = false;
    Promise.all([
      api<{ project: unknown }>("/api/advertising/project"),
      api("/api/advertising/health"),
    ])
      .then(([data]) => {
        if (disposed) return;
        if (!dirty.current) setProject(adSchema.parse(data.project));
        setReady(true);
        note("广告工程已读取。修改参数后可实时预览，保存与渲染是独立操作。");
      })
      .catch((e) => {
        if (!disposed)
          note(
            "云端读取未完成：" + String(e) + "。可使用本机 JSON 继续编辑。",
            true,
          );
      });
    api<{ assets: Asset[] }>("/api/assets")
      .then((data) => {
        if (!disposed) setAssets(data.assets);
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    if (!dirty.current) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify(project));
    } catch {
      /* Manual JSON export remains available. */
    }
  }, [project]);
  useEffect(() => {
    if (!ready) return;
    let disposed = false;
    const update = () =>
      api<{ jobs: Job[] }>("/api/advertising/jobs")
        .then((data) => {
          if (!disposed) setJobs(data.jobs);
        })
        .catch(() => {});
    void update();
    const timer = setInterval(() => void update(), 1400);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [ready]);
  const save = () =>
    run(async () => {
      await api("/api/advertising/project", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: adSchema.parse(project) }),
      });
      note("广告工程已保存到云端。");
    });
  const render = () =>
    run(async () => {
      const request = renderRequestSchema.parse({
        project,
        resolution,
        format,
      });
      const job = await api<Job>("/api/advertising/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      await refresh();
      note(
        "已提交真实渲染任务：" +
          job.id.slice(0, 8) +
          "。队列一次处理一条，不会使用其他业务的容器。",
      );
    });
  const batchRender = () =>
    run(async () => {
      const titles = batchTitles
        .split("\n")
        .map((v) => v.trim())
        .filter(Boolean);
      if (titles.length < 1 || titles.length > 3)
        throw Error("批量任务需要 1–3 行主标题");
      const requests = titles.map((headline) =>
        renderRequestSchema.parse({
          project: {
            ...project,
            headline,
            name: project.name + " / " + headline,
          },
          resolution,
          format,
        }),
      );
      for (const request of requests)
        await api("/api/advertising/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
      await refresh();
      note(
        "已提交 " +
          requests.length +
          " 条独立渲染任务，统一使用当前模板、包装与音轨设置。",
      );
    });
  const upload = (files: File[]) =>
    run(async () => {
      for (const file of files) {
        if (
          !["image/png", "image/jpeg", "image/webp"].includes(file.type) &&
          !file.type.startsWith("audio/")
        )
          throw Error("请选择 PNG/JPEG/WebP 图片或音频");
        const body = new FormData();
        body.append("file", file);
        const asset = await api<Asset>("/api/assets/upload", {
          method: "POST",
          body,
        });
        setAssets((items) => [asset, ...items]);
        dirty.current = true;
        if (file.type.startsWith("image/"))
          setProject((p) => ({
            ...p,
            imageAssetIds: [...p.imageAssetIds, asset.id].slice(-12),
          }));
        else
          setProject((p) => ({
            ...p,
            music: { ...p.music, assetId: asset.id, enabled: true },
          }));
      }
      note("素材已实际上传并加入广告工程；请保存工程。");
    });
  return (
    <div className="ad-workbench">
      <header className="ad-header">
        <div>
          <div className="ad-eyebrow">NEXUS FX STUDIO / MOTION & SOUND</div>
          <h1>广告动效工作台</h1>
        </div>
        <div className="row wrap">
          <a className="ad-back" href="#">
            返回 3D 工程
          </a>
          <button
            data-testid="ad-load-example"
            disabled={busy || !valid}
            onClick={loadExample}
          >
            载入带声字幕示范
          </button>
          {canRestoreExample && (
            <button
              data-testid="ad-restore-example"
              disabled={busy}
              onClick={restoreExample}
            >
              恢复载入前参数
            </button>
          )}
          <button onClick={() => file.current?.click()}>导入工程</button>
          <button
            onClick={() =>
              download(
                new Blob([JSON.stringify({ project }, null, 2)], {
                  type: "application/json",
                }),
                "nexus-ad-project.json",
              )
            }
          >
            导出 JSON
          </button>
          <button
            className="primary"
            disabled={busy || !ready || !valid}
            onClick={save}
          >
            保存到云端
          </button>
        </div>
      </header>
      <div
        className={"global-status " + (error ? "err" : "ok")}
        role={error ? "alert" : "status"}
      >
        {status}
        {!ready && (
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const data = await api<{ project: unknown }>(
                  "/api/advertising/project",
                );
                await api("/api/advertising/health");
                if (!dirty.current) setProject(adSchema.parse(data.project));
                setReady(true);
                note("广告渲染服务已连接；本机编辑内容保持。");
              })
            }
          >
            重试连接
          </button>
        )}
      </div>
      <input
        ref={file}
        data-testid="ad-import"
        hidden
        type="file"
        accept=".json"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f)
            void run(async () => {
              if (f.size > 128 * 1024) throw Error("工程文件超过 128 KB");
              const data = JSON.parse(await f.text());
              patch(adSchema.parse(data.project ?? data));
              note("广告工程 JSON 已导入；媒体文件需在当前服务器存在。");
            });
          e.target.value = "";
        }}
      />
      <input
        ref={media}
        data-testid="ad-media"
        hidden
        multiple
        type="file"
        accept="image/png,image/jpeg,image/webp,audio/*"
        onChange={(e) => {
          void upload([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      <div className="ad-layout">
        <aside className="panel ad-form">
          <h2>01 / 广告模板</h2>
          {templates.map(([id, name, description]) => (
            <button
              key={id}
              data-testid={"template-" + id}
              className={
                "ad-template " + (project.template === id ? "selected" : "")
              }
              onClick={() => {
                patch({ template: id });
                if (id !== "cloud") setFormat("mp4");
              }}
            >
              <strong>{name}</strong>
              <small>{description}</small>
            </button>
          ))}
          <h2>02 / 品牌与素材</h2>
          <label>
            工程名称
            <input
              data-testid="ad-name"
              maxLength={100}
              value={project.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </label>
          <label>
            主标题
            <input
              data-testid="ad-headline"
              maxLength={32}
              value={project.headline}
              onChange={(e) => patch({ headline: e.target.value })}
            />
          </label>
          <label>
            副标题
            <textarea
              maxLength={72}
              value={project.tagline}
              onChange={(e) => patch({ tagline: e.target.value })}
            />
          </label>
          <label>
            品牌主色
            <input
              type="color"
              value={project.accent}
              onChange={(e) => patch({ accent: e.target.value })}
            />
          </label>
          <button disabled={busy} onClick={() => media.current?.click()}>
            ＋ 上传产品图／背景音乐
          </button>
          <p className="muted">
            图片用于环绕卡片；不选图片时使用原创图形。当前{" "}
            {project.imageAssetIds.length} 张图片。
          </p>
          {project.imageAssetIds.length > 0 && (
            <button onClick={() => patch({ imageAssetIds: [] })}>
              清空卡片图片引用
            </button>
          )}
          <button
            onClick={() => {
              try {
                const raw = localStorage.getItem(draftKey);
                if (!raw) throw Error("无本机草稿");
                patch(adSchema.parse(JSON.parse(raw)));
                note("已恢复本机草稿，尚未同步云端。");
              } catch (e) {
                note(String(e), true);
              }
            }}
          >
            恢复本机草稿
          </button>
        </aside>
        <main className="ad-center">
          <ReferenceAnalysis
            onImportSubtitles={(text, name) => {
              setCaptionImport({ text, name, key: Date.now() });
              document
                .getElementById("caption-editor")
                ?.scrollIntoView({ behavior: "smooth" });
            }}
          />
          <section className="panel ad-preview">
            <div className="timehead">
              <h2>实时动画与声音预览</h2>
              <span className="tag">16:9 · 30 FPS</span>
            </div>
            <div className={"ad-player " + (format !== "mp4" ? "checker" : "")}>
              <Player
                ref={player}
                component={AdFilm}
                inputProps={{
                  project,
                  assetBase: "/api/assets/",
                  resolution,
                  transparent: format !== "mp4",
                }}
                durationInFrames={Math.max(
                  1,
                  Math.round(project.duration * 30),
                )}
                fps={30}
                compositionWidth={1920}
                compositionHeight={1080}
                initialFrame={45}
                controls
                loop
                clickToPlay
                style={{ width: "100%" }}
                errorFallback={({ error }) => (
                  <div
                    role="alert"
                    style={{
                      padding: 24,
                      color: "#ffc4b3",
                      background: "#171f2b",
                    }}
                  >
                    预览无法加载：{error.message}
                    。请检查图片／音频是否仍在素材库；可以继续修改或导出工程。
                  </div>
                )}
                acknowledgeRemotionLicense
              />
            </div>
            <p className="muted">
              预览与服务端渲染共用同一个 Remotion
              合成。点击播放可听音乐和音效；示例图表数据不代表真实业务业绩。
            </p>
          </section>
          <CaptionEditor
            track={project.captions}
            duration={project.duration}
            musicEnabled={project.music.enabled}
            sfx={project.sfx}
            player={player}
            incoming={captionImport}
            onChange={(captions) => patch({ captions })}
          />
          <section className="panel ad-audio">
            <h2>03 / 音乐与独立音效</h2>
            <label className="check">
              <input
                type="checkbox"
                data-testid="music-enabled"
                checked={project.music.enabled}
                onChange={(e) =>
                  patch({
                    music: { ...project.music, enabled: e.target.checked },
                  })
                }
              />
              启用背景音乐
            </label>
            <div className="ad-two">
              <label>
                音乐素材
                <select
                  value={project.music.assetId ?? ""}
                  onChange={(e) =>
                    patch({
                      music: {
                        ...project.music,
                        assetId: e.target.value || null,
                      },
                    })
                  }
                >
                  <option value="">NEXUS 原创合成配乐</option>
                  {assets
                    .filter((a) => a.contentType.startsWith("audio/"))
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                音乐音量 {Math.round(project.music.gain * 100)}%
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={project.music.gain}
                  onChange={(e) =>
                    patch({
                      music: { ...project.music, gain: Number(e.target.value) },
                    })
                  }
                />
              </label>
            </div>
            {project.sfx.map((event, index) => (
              <div className="ad-cue" key={index}>
                <select
                  aria-label={"音效 " + (index + 1)}
                  value={event.type}
                  onChange={(e) =>
                    patch({
                      sfx: project.sfx.map((v, i) =>
                        i === index
                          ? { ...v, type: e.target.value as typeof v.type }
                          : v,
                      ),
                    })
                  }
                >
                  <option value="whoosh">转场 / Whoosh</option>
                  <option value="impact">冲击 / Impact</option>
                  <option value="click">点击 / Click</option>
                </select>
                <label>
                  开始秒
                  <input
                    aria-label={"音效开始 " + (index + 1)}
                    type="number"
                    min="0"
                    max={project.duration - 0.1}
                    step=".1"
                    value={event.time}
                    onChange={(e) =>
                      patch({
                        sfx: project.sfx.map((v, i) =>
                          i === index
                            ? {
                                ...v,
                                time: Math.max(
                                  0,
                                  Math.min(
                                    project.duration - 0.1,
                                    Number(e.target.value),
                                  ),
                                ),
                              }
                            : v,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  音量 {Math.round(event.gain * 100)}%
                  <input
                    aria-label={"音效音量 " + (index + 1)}
                    type="range"
                    min="0"
                    max="1"
                    step=".01"
                    value={event.gain}
                    onChange={(e) =>
                      patch({
                        sfx: project.sfx.map((v, i) =>
                          i === index
                            ? { ...v, gain: Number(e.target.value) }
                            : v,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  aria-label={"删除音效 " + (index + 1)}
                  onClick={() =>
                    patch({ sfx: project.sfx.filter((_, i) => i !== index) })
                  }
                >
                  删除
                </button>
              </div>
            ))}
            <button
              data-testid="ad-add-sfx"
              disabled={project.sfx.length >= 12}
              onClick={() =>
                patch({
                  sfx: [...project.sfx, { type: "click", time: 0, gain: 0.4 }],
                })
              }
            >
              ＋ 添加独立音效
            </button>
          </section>
          <section className="panel">
            <h2>04 / 渲染任务</h2>
            {jobs.length === 0 ? (
              <p className="muted">
                提交后显示实际进度。失败的任务会给出原因，不会产生假下载链接。
              </p>
            ) : (
              jobs.map((job) => (
                <div key={job.id} className="ad-job" data-testid="ad-job">
                  <div>
                    <strong>{job.name}</strong>
                    <small>
                      {job.resolution} · {job.format} · {job.status}
                      {job.elapsedSeconds
                        ? ` · ${job.elapsedSeconds.toFixed(1)} 秒`
                        : ""}
                    </small>
                  </div>
                  <progress max="1" value={job.progress} />
                  <span>{Math.round(job.progress * 100)}%</span>
                  {job.downloadUrl && (
                    <a className="ad-back" href={job.downloadUrl}>
                      下载视频
                    </a>
                  )}
                  <button
                    onClick={() =>
                      void run(async () => {
                        await api("/api/advertising/jobs/" + job.id, {
                          method: "DELETE",
                        });
                        await refresh();
                        note(
                          job.status === "queued" || job.status === "running"
                            ? "已请求取消任务。"
                            : "任务及导出文件已删除；工程保留。",
                        );
                      })
                    }
                  >
                    {["queued", "running"].includes(job.status)
                      ? "取消"
                      : "删除"}
                  </button>
                  {job.error && <p className="ad-job-error">{job.error}</p>}
                </div>
              ))
            )}
          </section>
        </main>
        <aside className="panel ad-form">
          <h2>05 / 动效参数</h2>
          <label>
            时长 / 秒
            <input
              data-testid="ad-duration"
              type="number"
              min="4"
              max="30"
              value={project.duration}
              onChange={(e) => {
                const duration = Math.max(
                  4,
                  Math.min(30, Math.round(Number(e.target.value))),
                );
                patch({
                  duration,
                  sfx: project.sfx.filter((v) => v.time < duration),
                });
              }}
            />
          </label>
          <label>
            旋转速度 {project.speed.toFixed(2)}×
            <input
              type="range"
              min=".25"
              max="3"
              step=".05"
              value={project.speed}
              onChange={(e) => patch({ speed: Number(e.target.value) })}
            />
          </label>
          <label>
            卡片环绕半径 {project.radius.toFixed(2)}×
            <input
              type="range"
              min=".5"
              max="1.3"
              step=".05"
              value={project.radius}
              onChange={(e) => patch({ radius: Number(e.target.value) })}
            />
          </label>
          <label>
            卡片／指标名称（每行一个，3–12 项）
            <textarea
              data-testid="ad-labels"
              rows={8}
              value={project.labels.join("\n")}
              onChange={(e) =>
                patch({
                  labels: e.target.value
                    .split("\n")
                    .slice(0, 12)
                    .map((v) => v.slice(0, 12)),
                })
              }
            />
          </label>
          <h3>HUD 四项数据</h3>
          {project.values.map((v, i) => (
            <label key={i}>
              {project.labels[i] || "指标 " + (i + 1)}
              <input
                aria-label={"指标数据 " + (i + 1)}
                type="number"
                min="0"
                max="10000000"
                value={v}
                onChange={(e) =>
                  patch({
                    values: project.values.map((v, j) =>
                      j === i
                        ? Math.max(
                            0,
                            Math.min(
                              10000000,
                              Math.round(Number(e.target.value)),
                            ),
                          )
                        : v,
                    ),
                  })
                }
              />
            </label>
          ))}
          <h2>06 / 视频输出</h2>
          <label>
            分辨率
            <select
              value={resolution}
              onChange={(e) =>
                setResolution(e.target.value as typeof resolution)
              }
            >
              <option value="720p">1280 × 720</option>
              <option value="1080p">1920 × 1080</option>
            </select>
          </label>
          <label>
            格式
            <select
              data-testid="ad-format"
              value={format}
              onChange={(e) => setFormat(e.target.value as typeof format)}
            >
              <option value="mp4">MP4 · 带声音成片</option>
              <option
                value="webm-alpha"
                disabled={project.template !== "cloud"}
              >
                WebM · 透明卡片素材
              </option>
              <option value="prores" disabled={project.template !== "cloud"}>
                ProRes 4444 · 透明 MOV
              </option>
            </select>
          </label>
          <button
            data-testid="ad-render"
            className="primary wide"
            disabled={
              busy ||
              !ready ||
              !renderRequestSchema.safeParse({ project, resolution, format })
                .success
            }
            onClick={render}
          >
            渲染并生成视频
          </button>
          <p className="muted">
            一次渲染一条，最多排队 3 条，单条 4–30
            秒。透明格式用于卡片云；ProRes 首批限 720p、10 秒以内。
          </p>
          <label>
            批量套模板（每行一个主标题，最多 3 条）
            <textarea
              data-testid="ad-batch-titles"
              rows={3}
              value={batchTitles}
              onChange={(e) => setBatchTitles(e.target.value)}
              placeholder={"新品发布\n品牌升级\n限时活动"}
            />
          </label>
          <button
            data-testid="ad-batch-render"
            disabled={busy || !ready || !valid || !batchTitles.trim()}
            onClick={batchRender}
          >
            批量渲染广告
          </button>
          <p className="muted">
            当前为共享广告工程。AI
            生图、智能口播剪辑和自动语音识别尚未接入；不会以按钮代替服务。
          </p>
        </aside>
      </div>
    </div>
  );
}
