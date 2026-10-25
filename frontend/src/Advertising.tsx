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
import { EffectLibrary, effects } from "./EffectLibrary";
import { SequenceOverview } from "./SequenceOverview";
import { navigateTab } from "./tabNavigation";
import { AD_OFFLINE_PREVIEW } from "../../video/mediaSource";

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
const draftKey = AD_OFFLINE_PREVIEW
  ? "nexus-ad-draft-offline-v2"
  : "nexus-ad-draft-v1";
const exampleBackupKey = "nexus-ad-before-example-v2";
type ExampleBackup = {
  project: AdProject;
  format: "mp4" | "webm-alpha" | "prores";
  resolution: "720p" | "1080p";
};
export function Advertising() {
  const [view, setView] = useState<
    "storyboard" | "captions" | "audio" | "reference" | "jobs"
  >("storyboard");
  const [inspector, setInspector] = useState<"brand" | "motion" | "export">(
    "brand",
  );
  const [step, setStep] = useState("effects");
  const [savedSnapshot, setSavedSnapshot] = useState(JSON.stringify(defaultAd));
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
  const outputValidation = renderRequestSchema.safeParse({
    project,
    resolution,
    format,
  });
  const canRender =
    !AD_OFFLINE_PREVIEW && !busy && ready && outputValidation.success;
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
          ? AD_OFFLINE_PREVIEW
            ? "已载入 15 秒带声字幕示范工程，可播放、修改和试听；点击保存才写入本机。"
            : "已载入 15 秒带声字幕示范工程，可播放、修改和渲染；点击保存才会同步云端。"
          : "示范工程可先预览；云端渲染服务尚未连接。") +
          (durable
            ? " 载入前参数已备份，可在工程文件菜单恢复。"
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
      note(
        AD_OFFLINE_PREVIEW
          ? "已恢复最近一次载入前的工程参数，尚未保存到本机。"
          : "已恢复最近一次载入前的工程参数，尚未同步云端。",
      );
    });
  useEffect(() => {
    let disposed = false;
    Promise.all([
      api<{ project: unknown }>("/api/advertising/project"),
      api("/api/advertising/health"),
    ])
      .then(([data]) => {
        if (disposed) return;
        const loaded = adSchema.parse(data.project);
        setSavedSnapshot(JSON.stringify(loaded));
        if (!dirty.current) setProject(loaded);
        setReady(true);
        note(
          AD_OFFLINE_PREVIEW
            ? "本机广告工程已读取。可编辑、试听和保存；云端渲染需使用线上版。"
            : "广告工程已读取。修改参数后可实时预览，保存与渲染是独立操作。",
        );
      })
      .catch((e) => {
        if (!disposed)
          note(
            (AD_OFFLINE_PREVIEW ? "本机读取未完成：" : "云端读取未完成：") +
              String(e) +
              "。可使用本机 JSON 继续编辑。",
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
      const snapshot = adSchema.parse(project);
      await api("/api/advertising/project", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: snapshot }),
      });
      setSavedSnapshot(JSON.stringify(snapshot));
      note(
        AD_OFFLINE_PREVIEW
          ? "广告工程已保存到本机。"
          : "广告工程已保存到云端。",
      );
    });
  const render = () =>
    run(async () => {
      setView("jobs");
      setInspector("export");
      setStep("export");
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
      setView("jobs");
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
      player.current?.pause();
      note(AD_OFFLINE_PREVIEW ? "正在导入本机素材…" : "正在上传素材…");
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
      note(
        AD_OFFLINE_PREVIEW
          ? "素材已保存到本机并加入广告工程；请保存工程。"
          : "素材已实际上传并加入广告工程；请保存工程。",
      );
    });
  return (
    <div className="ad-workbench">
      {AD_OFFLINE_PREVIEW && (
        <div className="ad-offline-note" role="note">
          本机可操作试用 ·
          编辑、播放、试听与保存可用；云端渲染和参考解析需部署后使用。
        </div>
      )}
      <header className="ad-header">
        <div className="ad-brand">
          <span className="ad-mark" aria-hidden="true">
            N
          </span>
          <div>
            <div className="ad-eyebrow">NEXUS / MOTION STUDIO</div>
            <h1>广告动效工作台</h1>
          </div>
        </div>
        <div className="ad-project-state">
          <strong title={project.name}>{project.name}</strong>
          <span
            data-testid="ad-save-state"
            className={
              JSON.stringify(project) !== savedSnapshot ? "unsaved" : ""
            }
          >
            {!ready
              ? AD_OFFLINE_PREVIEW
                ? "本机存储未就绪"
                : "本地编辑 · 云端未连接"
              : JSON.stringify(project) !== savedSnapshot
                ? "● 修改尚未保存"
                : AD_OFFLINE_PREVIEW
                  ? "● 与本机一致"
                  : "● 与云端一致"}
          </span>
        </div>
        <div className="row wrap ad-header-actions">
          {!AD_OFFLINE_PREVIEW && (
            <a className="ad-back" href="#">
              返回 3D 工程
            </a>
          )}
          <details className="ad-file-menu">
            <summary>工程文件 ▾</summary>
            <div>
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
              {canRestoreExample && (
                <button
                  data-testid="ad-restore-example"
                  disabled={busy}
                  onClick={restoreExample}
                >
                  恢复载入前参数
                </button>
              )}
            </div>
          </details>
          <button
            data-testid="ad-load-example"
            disabled={busy || !valid}
            onClick={loadExample}
          >
            载入带声字幕示范
          </button>
          <button disabled={busy || !ready || !valid} onClick={save}>
            {AD_OFFLINE_PREVIEW ? "保存到本机" : "保存到云端"}
          </button>
          <button
            data-testid="ad-render"
            className="primary"
            disabled={!canRender}
            onClick={render}
          >
            {AD_OFFLINE_PREVIEW ? "云端渲染未连接" : "渲染并生成视频"}{" "}
            <span aria-hidden="true">↗</span>
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
                const loaded = adSchema.parse(data.project);
                setSavedSnapshot(JSON.stringify(loaded));
                if (!dirty.current) setProject(loaded);
                setReady(true);
                note("广告渲染服务已连接；本机编辑内容保持。");
              })
            }
          >
            重试连接
          </button>
        )}
      </div>
      <nav className="ad-workflow" aria-label="广告制作步骤">
        {(
          [
            ["effects", "选效果", "应用真实动画模板"],
            ["assets", "换素材", "品牌文案与产品图片"],
            ["motion", "调动画", "节奏、卡片与数据"],
            ["sound", "字幕与声音", "逐条控制时间与音量"],
            ["export", "导出成片", "规格与实际任务"],
          ] as const
        ).map(([id, title, hint], index) => (
          <button
            key={id}
            data-testid={"step-" + id}
            aria-current={step === id ? "step" : undefined}
            onClick={() => {
              setStep(id);
              if (id === "assets") setInspector("brand");
              if (id === "motion") {
                setInspector("motion");
                setView("storyboard");
              }
              if (id === "sound") setView("captions");
              if (id === "export") {
                setInspector("export");
                setView("jobs");
              }
              const target =
                id === "effects"
                  ? ".ad-library"
                  : id === "sound"
                    ? "#tool-panel-captions"
                    : "#inspector-panel-" +
                      (id === "assets"
                        ? "brand"
                        : id === "motion"
                          ? "motion"
                          : "export");
              requestAnimationFrame(() =>
                document.querySelector(target)?.scrollIntoView({
                  block: "nearest",
                  behavior: window.matchMedia(
                    "(prefers-reduced-motion: reduce)",
                  ).matches
                    ? "auto"
                    : "smooth",
                }),
              );
            }}
          >
            <span className="ad-step-number">0{index + 1}</span>
            <span>
              <strong>{title}</strong>
              <small>{hint}</small>
            </span>
            <span className="ad-step-arrow" aria-hidden="true">
              →
            </span>
          </button>
        ))}
      </nav>
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
        <EffectLibrary
          project={project}
          assets={assets}
          busy={busy}
          onSelect={(template) => {
            patch({ template });
            if (template !== "cloud") setFormat("mp4");
            setStep("effects");
          }}
          onUpload={() => media.current?.click()}
          onImages={(imageAssetIds) => patch({ imageAssetIds })}
          onReference={() => setView("reference")}
        />
        <main className="ad-center">
          <section className="panel ad-preview">
            <div className="timehead">
              <div>
                <span className="ad-kicker">LIVE CANVAS</span>
                <h2>
                  {
                    effects.find((effect) => effect.id === project.template)
                      ?.name
                  }
                </h2>
              </div>
              <span className="tag">{project.duration}s · 16:9 · 30 FPS</span>
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
            <div className="ad-preview-footer">
              <span>播放试听音乐与音效</span>
              <span>
                {project.captions.enabled
                  ? project.captions.cues.length + " 条字幕"
                  : "字幕已关闭"}{" "}
                · {resolution} · {format === "mp4" ? "MP4" : "透明素材"}
              </span>
            </div>
          </section>
          <section className="panel ad-dock" aria-label="制作面板">
            <div className="ad-dock-tabs" role="tablist" aria-label="制作工具">
              {(
                [
                  ["storyboard", "分镜总览"],
                  ["captions", "字幕"],
                  ["audio", "声音"],
                  ["reference", "参考解析"],
                  ["jobs", "导出任务"],
                ] as const
              ).map(([id, title]) => (
                <button
                  role="tab"
                  key={id}
                  id={"tool-tab-" + id}
                  aria-selected={view === id}
                  tabIndex={view === id ? 0 : -1}
                  onKeyDown={navigateTab}
                  aria-controls={"tool-panel-" + id}
                  onClick={() => setView(id)}
                >
                  {title}
                  {id === "jobs" && jobs.length > 0 ? " · " + jobs.length : ""}
                </button>
              ))}
            </div>
            <div
              role="tabpanel"
              id="tool-panel-storyboard"
              aria-labelledby="tool-tab-storyboard"
              hidden={view !== "storyboard"}
            >
              <SequenceOverview
                project={project}
                player={player}
                onEdit={setView}
              />
            </div>
            <div
              role="tabpanel"
              id="tool-panel-captions"
              aria-labelledby="tool-tab-captions"
              hidden={view !== "captions"}
            >
              <CaptionEditor
                track={project.captions}
                duration={project.duration}
                musicEnabled={project.music.enabled}
                sfx={project.sfx}
                player={player}
                incoming={captionImport}
                onChange={(captions) => patch({ captions })}
              />
            </div>
            <div
              role="tabpanel"
              id="tool-panel-audio"
              aria-labelledby="tool-tab-audio"
              hidden={view !== "audio"}
            >
              <section className="panel ad-audio">
                <h2>音乐与独立音效</h2>
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
                      aria-label="音乐素材"
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
                          music: {
                            ...project.music,
                            gain: Number(e.target.value),
                          },
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
                        patch({
                          sfx: project.sfx.filter((_, i) => i !== index),
                        })
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
                      sfx: [
                        ...project.sfx,
                        { type: "click", time: 0, gain: 0.4 },
                      ],
                    })
                  }
                >
                  ＋ 添加独立音效
                </button>
              </section>
            </div>
            <div
              role="tabpanel"
              id="tool-panel-reference"
              aria-labelledby="tool-tab-reference"
              hidden={view !== "reference"}
            >
              {AD_OFFLINE_PREVIEW ? (
                <p className="muted" style={{ padding: 20 }}>
                  参考片抽帧、OCR
                  和音轨提取需要云端解析服务，本机试用未连接该服务。
                </p>
              ) : (
                <ReferenceAnalysis
                  onImportSubtitles={(text, name) => {
                    setCaptionImport({ text, name, key: Date.now() });
                    setView("captions");
                  }}
                />
              )}
            </div>
            <div
              role="tabpanel"
              id="tool-panel-jobs"
              aria-labelledby="tool-tab-jobs"
              hidden={view !== "jobs"}
            >
              <section className="panel">
                <h2>导出任务与成片</h2>
                {jobs.length === 0 ? (
                  <p className="muted">
                    {AD_OFFLINE_PREVIEW
                      ? "本机版可预览和导出工程 JSON；视频渲染需要部署云端服务。"
                      : "还没有导出任务。确认画面和声音后，点击顶部‘渲染并生成视频’。"}
                  </p>
                ) : (
                  jobs.map((job) => (
                    <div key={job.id} className="ad-job" data-testid="ad-job">
                      <div>
                        <strong>{job.name}</strong>
                        <small>
                          {job.resolution} · {job.format} ·{" "}
                          {{
                            queued: "排队中",
                            running: "渲染中",
                            done: "已完成",
                            failed: "失败",
                            cancelled: "已取消",
                          }[job.status] ?? job.status}
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
                              job.status === "queued" ||
                                job.status === "running"
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
            </div>
          </section>
        </main>
        <aside className="panel ad-inspector" aria-label="当前广告参数">
          <div
            className="ad-inspector-tabs"
            role="tablist"
            aria-label="参数分类"
          >
            {(
              [
                ["brand", "品牌"],
                ["motion", "动画"],
                ["export", "导出"],
              ] as const
            ).map(([id, title]) => (
              <button
                role="tab"
                id={"inspector-tab-" + id}
                aria-controls={"inspector-panel-" + id}
                aria-selected={inspector === id}
                tabIndex={inspector === id ? 0 : -1}
                onKeyDown={navigateTab}
                key={id}
                onClick={() => setInspector(id)}
              >
                {title}
              </button>
            ))}
          </div>
          <div
            className="ad-form"
            role="tabpanel"
            id="inspector-panel-brand"
            aria-labelledby="inspector-tab-brand"
            hidden={inspector !== "brand"}
          >
            <h2>品牌与文案</h2>
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
          </div>
          <div
            className="ad-form"
            role="tabpanel"
            id="inspector-panel-motion"
            aria-labelledby="inspector-tab-motion"
            hidden={inspector !== "motion"}
          >
            <h2>动画与数据</h2>
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
          </div>
          <div
            className="ad-form"
            role="tabpanel"
            id="inspector-panel-export"
            aria-labelledby="inspector-tab-export"
            hidden={inspector !== "export"}
          >
            <h2>输出设置</h2>
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
              data-testid="ad-export-confirm"
              className="primary wide"
              disabled={!canRender}
              onClick={render}
            >
              生成这条广告 ↗
            </button>
            {!outputValidation.success && (
              <p className="ad-job-error" role="alert">
                {outputValidation.error.issues[0].message}
              </p>
            )}
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
              当前为共享广告工程。AI 生图、智能口播剪辑和自动语音识别尚未接入。
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
