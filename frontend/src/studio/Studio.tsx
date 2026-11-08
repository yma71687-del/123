import { useEffect, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { StudioFilm } from "../../../video/studio/Film";
import {
  defaultStudio,
  importLegacyAd,
  newShot,
  recipes,
  studioSchema,
  transformAt,
  type StudioProject,
  type StudioShot,
  type KeyProperty,
} from "../../../video/studio/schema";
import { api, download, message } from "../io";
import type { Asset } from "../schema";
import { CaptionEditor } from "../CaptionEditor";
import { StudioHistory, splitShot } from "./edit";
import { DraftInput, DraftTextarea } from "./DraftFields";
import "../advertising.css";
import "./studio.css";

type RecordData = {
  id: string;
  revision: number;
  updatedAt: string;
  project: StudioProject;
};
type Summary = {
  id: string;
  revision: number;
  name: string;
  updatedAt: string;
};
type Job = {
  id: string;
  name: string;
  status: string;
  progress: number;
  error?: string;
  downloadUrl: string | null;
  elapsedSeconds?: number;
};
type Selection = { kind: "shot" | "audio"; id: string };
const uid = () => crypto.randomUUID().replaceAll("-", "");
const seconds = (frame: number) => (frame / 30).toFixed(2) + "s";
const recipeName = (shot: StudioShot) =>
  recipes.find((r) => r.id === shot.recipe)?.name ?? "旧广告（原参数保留）";
const audioNames: Record<string, string> = {
  pulse: "原创配乐",
  whoosh: "转场掠过",
  impact: "低频强调",
  click: "轻触声",
};
const propertyNames: Record<string, string> = {
  x: "水平位置",
  y: "垂直位置",
  scale: "缩放",
  opacity: "不透明度",
};
const jobNames: Record<string, string> = {
  queued: "排队中",
  running: "正在渲染",
  done: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

export function Studio() {
  const history = useRef(new StudioHistory(defaultStudio()));
  const previewBox = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false),
    [previewMuted, setPreviewMuted] = useState(false),
    [fullscreen, setFullscreen] = useState(false);
  const edited = useRef(false);
  const [project, setProject] = useState(history.current.current);
  const [selection, setSelection] = useState<Selection>({
    kind: "shot",
    id: "hero",
  });
  const [record, setRecord] = useState<RecordData | null>(null),
    [saved, setSaved] = useState("");
  const [projects, setProjects] = useState<Summary[]>([]),
    [versions, setVersions] = useState<number[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]),
    [jobs, setJobs] = useState<Job[]>([]);
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("正在连接项目和渲染服务…"),
    [failed, setFailed] = useState(false);
  const [frame, setFrame] = useState(0),
    [tab, setTab] = useState<"timeline" | "captions" | "jobs">("timeline");
  const [keyProperty, setKeyProperty] = useState<KeyProperty>("x"),
    [keyValue, setKeyValue] = useState(0);
  const [resolution, setResolution] = useState<"720p" | "1080p">("720p");
  const player = useRef<PlayerRef>(null),
    upload = useRef<HTMLInputElement>(null),
    jsonFile = useRef<HTMLInputElement>(null);
  const selectedShot =
    selection.kind === "shot"
      ? project.shots.find((s) => s.id === selection.id)
      : undefined;
  const selectedAudio =
    selection.kind === "audio"
      ? project.audio.find((a) => a.id === selection.id)
      : undefined;
  const dirty = JSON.stringify(project) !== saved;
  const note = (text: string, error = false) => {
    setStatus(text);
    setFailed(error);
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      note(message(e), true);
    } finally {
      setBusy(false);
    }
  };
  const commit = (change: (p: StudioProject) => void, key?: string) => {
    try {
      edited.current = true;
      history.current.commit(change, key);
      setProject(history.current.current);
    } catch (e) {
      note(
        e instanceof Error && "issues" in e
          ? "修改超出工程范围，请检查时长、素材或关键帧"
          : message(e),
        true,
      );
    }
  };
  const undo = (redo = false) => {
    redo ? history.current.redo() : history.current.undo();
    setProject(history.current.current);
  };
  const seek = (next: number) => {
    const f = Math.round(
      Math.max(0, Math.min(project.durationFrames - 1, next)),
    );
    player.current?.pause();
    player.current?.seekTo(f);
    setFrame(f);
  };
  const select = (s: Selection) => {
    setSelection(s);
  };
  const discard = () =>
    !dirty ||
    window.confirm(
      "当前修改尚未保存。继续将离开这份草稿；可取消后先保存或导出工程。是否继续？",
    );
  const remember = (id: string) => {
    const url = new URL(location.href);
    url.searchParams.set("studioProject", id);
    window.history.replaceState(null, "", url);
  };
  const useRecord = (data: RecordData) => {
    history.current.reset(data.project);
    setProject(history.current.current);
    setRecord(data);
    setSaved(JSON.stringify(data.project));
    setSelection({ kind: "shot", id: data.project.shots[0].id });
    seek(0);
    remember(data.id);
  };
  const refreshProjects = async () =>
    setProjects(
      (await api<{ projects: Summary[] }>("/api/studio/projects")).projects,
    );
  const save = async (copy = false) =>
    run(async () => {
      const snapshot = studioSchema.parse(history.current.current);
      const path =
        record && !copy
          ? "/api/studio/projects/" + record.id
          : "/api/studio/projects";
      const result = await api<RecordData>(path, {
        method: record && !copy ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: snapshot,
          expectedRevision: record?.revision,
        }),
      });
      setRecord(result);
      setSaved(JSON.stringify(snapshot));
      remember(result.id);
      await refreshProjects();
      note("已保存到服务端 · 版本 " + result.revision);
    });
  const open = (id: string) => {
    if (!discard()) return;
    void run(async () => {
      const data = await api<RecordData>("/api/studio/projects/" + id);
      useRecord(data);
      setVersions([]);
      note("已打开工程 · 版本 " + data.revision);
    });
  };
  const reset = (p: StudioProject) => {
    history.current.reset(p);
    setProject(history.current.current);
    setRecord(null);
    setSaved("");
    setVersions([]);
    setSelection({ kind: "shot", id: p.shots[0].id });
    seek(0);
    const url = new URL(location.href);
    url.searchParams.delete("studioProject");
    window.history.replaceState(null, "", url);
  };
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        await api("/api/studio/health");
        if (disposed) return;
        const [list, media] = await Promise.all([
          api<{ projects: Summary[] }>("/api/studio/projects"),
          api<{ assets: Asset[] }>("/api/assets"),
        ]);
        if (disposed) return;
        setProjects(list.projects);
        setAssets(media.assets);
        const id = new URL(location.href).searchParams.get("studioProject");
        if (id) {
          const data = await api<RecordData>("/api/studio/projects/" + id);
          if (disposed) return;
          if (!edited.current) useRecord(data);
        }
        setReady(true);
        note("服务已连接。上传产品图，修改镜头后保存或导出。");
      } catch (e) {
        if (!disposed)
          note(
            "服务读取未完成：" + message(e) + "。仍可本地编辑和导出工程。",
            true,
          );
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    const current = player.current;
    if (!current) return;
    const update = (e: { detail: { frame: number } }) =>
      setFrame(e.detail.frame);
    current.addEventListener("frameupdate", update);
    const playback = () => setPlaying(current.isPlaying());
    const full = () =>
      setFullscreen(document.fullscreenElement === previewBox.current);
    current.addEventListener("play", playback);
    current.addEventListener("pause", playback);
    current.addEventListener("ended", playback);
    document.addEventListener("fullscreenchange", full);
    return () => {
      current.removeEventListener("frameupdate", update);
      current.removeEventListener("play", playback);
      current.removeEventListener("pause", playback);
      current.removeEventListener("ended", playback);
      document.removeEventListener("fullscreenchange", full);
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    let disposed = false,
      wasError = false;
    const update = async () => {
      try {
        const data = await api<{ jobs: Job[] }>("/api/studio/jobs");
        if (!disposed) setJobs(data.jobs);
        wasError = false;
      } catch (e) {
        if (!disposed && !wasError)
          note("任务状态读取失败：" + message(e), true);
        wasError = true;
      }
    };
    void update();
    const timer = setInterval(() => void update(), 1200);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [ready]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement)?.closest(
          "input,textarea,select,[contenteditable]",
        )
      )
        return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo(event.shiftKey);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const patchShot = (change: (shot: StudioShot) => void, key?: string) =>
    commit((p) => {
      const s = p.shots.find((s) => s.id === selection.id);
      if (s) change(s);
    }, key);
  const addShot = (recipe: "hero" | "tunnel" | "layers", at = frame) => {
    const id = uid();
    commit((p) => {
      const shot = newShot(recipe, id, at);
      shot.durationFrames = Math.min(150, p.durationFrames - at);
      p.shots.push(shot);
    });
    select({ kind: "shot", id });
  };
  const addAudio = (kind: "music" | "sfx", assetId: string | null = null) => {
    const id = uid();
    commit((p) =>
      p.audio.push({
        id,
        kind,
        assetId,
        builtin: kind === "music" ? "pulse" : "whoosh",
        startFrame: frame,
        sourceInFrame: 0,
        durationFrames: Math.min(
          p.durationFrames - frame,
          kind === "music" ? 450 : 24,
        ),
        gain: kind === "music" ? 0.22 : 0.4,
        muted: false,
      }),
    );
    select({ kind: "audio", id });
  };
  const assignImage = (id: string) => {
    if (!selectedShot || !["hero", "layers"].includes(selectedShot.recipe)) {
      note("请选择产品主视觉或图片图层镜头，再添加图片。", true);
      return;
    }
    patchShot((s) => {
      s.params.imageAssetIds =
        s.recipe === "hero"
          ? [id]
          : [...new Set([...s.params.imageAssetIds, id])];
    });
  };
  const submit = () =>
    run(async () => {
      const job = await api<Job>("/api/studio/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: studioSchema.parse(history.current.current),
          resolution,
          format: "mp4",
        }),
      });
      setJobs((old) => [job, ...old]);
      setTab("jobs");
      note("已提交真实 MP4 渲染任务：" + job.id.slice(0, 8));
    });
  const setClipStart = (id: string, kind: Selection["kind"], start: number) =>
    commit((p) => {
      const list = kind === "shot" ? p.shots : p.audio,
        clip = list.find((c) => c.id === id);
      if (clip)
        clip.startFrame = Math.max(
          0,
          Math.min(p.durationFrames - clip.durationFrames, start),
        );
    });
  const drag = useRef<{
    id: string;
    kind: Selection["kind"];
    x: number;
    start: number;
    latest: number;
    width: number;
  } | null>(null);
  const [dragFrame, setDragFrame] = useState<number | null>(null);
  const clipBar = (
    id: string,
    kind: Selection["kind"],
    start: number,
    duration: number,
    label: string,
  ) => (
    <button
      key={id}
      type="button"
      data-testid={"clip-" + id}
      className={"st-clip " + kind + (selection.id === id ? " selected" : "")}
      style={{
        left:
          (100 *
            (drag.current?.id === id && dragFrame !== null
              ? dragFrame
              : start)) /
            project.durationFrames +
          "%",
        width: Math.max(1, (100 * duration) / project.durationFrames) + "%",
      }}
      aria-label={"选择片段 " + label}
      onClick={() => select({ kind, id })}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          setClipStart(
            id,
            kind,
            start + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 15 : 1),
          );
        }
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const width =
          e.currentTarget.parentElement!.getBoundingClientRect().width;
        drag.current = { id, kind, x: e.clientX, start, latest: start, width };
        e.currentTarget.setPointerCapture(e.pointerId);
        select({ kind, id });
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== id) return;
        const n = Math.max(
          0,
          Math.min(
            project.durationFrames - duration,
            Math.round(
              d.start + ((e.clientX - d.x) * project.durationFrames) / d.width,
            ),
          ),
        );
        d.latest = n;
        setDragFrame(n);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d || d.id !== id) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        drag.current = null;
        setDragFrame(null);
        if (d.latest !== d.start) setClipStart(id, kind, d.latest);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragFrame(null);
      }}
    >
      {label}
      <small>
        {seconds(start)} · {seconds(duration)}
      </small>
    </button>
  );
  const sourceFrame = selectedShot
    ? frame - selectedShot.startFrame + selectedShot.sourceInFrame
    : 0;
  const inSelected = Boolean(
    selectedShot &&
      frame >= selectedShot.startFrame &&
      frame < selectedShot.startFrame + selectedShot.durationFrames,
  );

  return (
    <main className="studio-shell">
      <header className="st-header">
        <div className="st-brand">
          <b>
            N<span>✦</span>
          </b>
          <div>
            <strong>NEXUS</strong>
            <small>广告片创作工作台 · 开发预览</small>
          </div>
        </div>
        <label className="st-project-name">
          工程名称
          <DraftInput
            aria-label="工程名称"
            value={project.name}
            maxLength={100}
            onChange={(e) =>
              commit((p) => {
                p.name = e.target.value;
              }, "name")
            }
          />
        </label>
        <span
          className={dirty ? "st-dirty" : "st-saved"}
          data-testid="studio-save-state"
        >
          {dirty ? "● 未保存修改" : "● 已保存 v" + record?.revision}
        </span>
        <button disabled={!ready || busy} onClick={() => void save()}>
          保存工程
        </button>
        <button
          className="st-primary"
          data-testid="studio-render"
          disabled={!ready || busy}
          onClick={() => void submit()}
        >
          导出 MP4 ↗
        </button>
      </header>
      <div
        role="status"
        aria-live="polite"
        className={"st-status" + (failed ? " error" : "")}
      >
        {status}
      </div>
      <div className="st-layout">
        <aside className="st-library">
          <div className="st-section-head">
            <h2>项目与素材</h2>
            <button
              onClick={() => {
                if (discard()) reset(defaultStudio());
              }}
            >
              新建
            </button>
          </div>
          <select
            aria-label="打开已保存工程"
            value={record?.id ?? ""}
            onChange={(e) => {
              if (e.target.value) open(e.target.value);
            }}
          >
            <option value="">选择已保存工程</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · v{p.revision}
              </option>
            ))}
          </select>
          <div className="st-row">
            <button disabled={!ready || busy} onClick={() => void save(true)}>
              另存为新项目
            </button>
            <button
              onClick={() =>
                download(
                  new Blob([JSON.stringify({ project }, null, 2)], {
                    type: "application/json",
                  }),
                  "NEXUS-project-ir.json",
                )
              }
            >
              备份 JSON
            </button>
          </div>
          <div className="st-row">
            <button onClick={() => jsonFile.current?.click()}>导入 JSON</button>
            <button
              disabled={!ready || busy}
              onClick={() => {
                if (discard())
                  void run(async () => {
                    const data = await api<{ project: unknown }>(
                      "/api/advertising/project",
                    );
                    reset(importLegacyAd(data.project));
                    note("旧广告已导入为新草稿，原工程未改写。");
                  });
              }}
            >
              导入旧广告
            </button>
          </div>
          <DraftInput
            ref={jsonFile}
            type="file"
            accept=".json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file || !discard()) return;
              void run(async () => {
                if (file.size > 128 * 1024) throw Error("工程文件超过128KB");
                const data = JSON.parse(await file.text());
                reset(
                  data.project?.format
                    ? studioSchema.parse(data.project)
                    : importLegacyAd(data.project ?? data),
                );
                note("已导入新草稿；素材引用需要当前服务器保留原文件。");
              });
            }}
          />
          <h2>
            镜头库 <small>3 个可编辑镜头</small>
          </h2>
          <div className="st-recipes">
            {recipes.map((r, i) => (
              <button
                key={r.id}
                data-testid={"add-" + r.id}
                disabled={project.shots.length >= 24}
                onClick={() => addShot(r.id)}
                draggable
                onDragStart={(e) =>
                  e.dataTransfer.setData("application/nexus-recipe", r.id)
                }
              >
                <span className={"st-recipe-art art-" + r.id}>
                  {["◉", "✺", "▱"][i]}
                  <small>0{i + 1}</small>
                </span>
                <strong>{r.name}</strong>
                <small>{r.description}</small>
                <em>＋ 添加到播放头</em>
              </button>
            ))}
          </div>
          <div className="st-section-head">
            <h2>我的素材</h2>
            <button
              disabled={!ready || busy}
              onClick={() => upload.current?.click()}
            >
              ＋ 上传
            </button>
          </div>
          <DraftInput
            ref={upload}
            type="file"
            accept="image/png,image/jpeg,image/webp,audio/*"
            hidden
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              void run(async () => {
                for (const file of files) {
                  if (file.size > 50 * 1024 ** 2)
                    throw Error("单个素材超过50MB");
                  const form = new FormData();
                  form.append("file", file);
                  const asset = await api<Asset>("/api/assets/upload", {
                    method: "POST",
                    body: form,
                  });
                  setAssets((old) => [asset, ...old]);
                }
                note(
                  "素材已上传。点击图片应用到选中镜头，或点击音频添加独立音轨。",
                );
              });
            }}
          />
          {!assets.length && (
            <p className="st-muted">
              上传产品图、透明图层或自己的音乐。未上传时预览使用原创抽象产品示范。
            </p>
          )}
          <div className="st-assets">
            {assets
              .filter(
                (a) =>
                  a.contentType?.startsWith("image/") ||
                  a.contentType?.startsWith("audio/"),
              )
              .map((a) => (
                <button
                  key={a.id}
                  title={a.name}
                  onClick={() =>
                    a.contentType?.startsWith("image/")
                      ? assignImage(a.id)
                      : addAudio("music", a.id)
                  }
                >
                  {a.contentType?.startsWith("image/") ? (
                    <img src={a.url} alt={a.name} />
                  ) : (
                    <span>♫</span>
                  )}
                  <small>{a.name}</small>
                </button>
              ))}
          </div>
          <p className="st-boundary">
            AI
            自动拆图与电影镜头生成尚未接入。本批提供真实图片、镜头和声音编辑。
          </p>
          <a
            href="#advertising"
            onClick={(e) => {
              if (!discard()) e.preventDefault();
            }}
          >
            返回旧广告工作台
          </a>
        </aside>
        <section className="st-center">
          <div className="st-preview-heading">
            <div>
              <small>画面预览</small>
              <h1>
                {selectedShot ? recipeName(selectedShot) : "声音与画面预览"}
              </h1>
            </div>
            <span>1920 × 1080 / 每秒30帧</span>
          </div>
          <div
            ref={previewBox}
            className="st-preview"
            data-testid="studio-preview"
          >
            <Player
              ref={player}
              component={StudioFilm}
              inputProps={{
                project,
                assetBase: "/api/assets/",
                resolution: "1080p",
              }}
              durationInFrames={project.durationFrames}
              compositionWidth={1920}
              compositionHeight={1080}
              fps={30}
              controls={false}
              style={{ width: "100%", height: "100%" }}
              errorFallback={({ error }) => (
                <div role="alert">
                  预览失败：{error.message}。请检查素材或打开其他镜头。
                </div>
              )}
            />
            <div
              className="st-preview-controls"
              role="group"
              aria-label="预览控制"
            >
              <button onClick={() => player.current?.toggle()}>
                {playing ? "暂停预览" : "播放预览"}
              </button>
              <button
                onClick={() => {
                  const current = player.current;
                  if (!current) return;
                  if (current.isMuted()) {
                    current.unmute();
                    setPreviewMuted(false);
                  } else {
                    current.mute();
                    setPreviewMuted(true);
                  }
                }}
              >
                {previewMuted ? "取消静音" : "静音预览"}
              </button>
              <button
                onClick={() => {
                  const operation = fullscreen
                    ? document.exitFullscreen()
                    : previewBox.current?.requestFullscreen();
                  operation?.catch((e) =>
                    note("全屏未完成：" + message(e), true),
                  );
                }}
              >
                {fullscreen ? "退出全屏" : "全屏预览"}
              </button>
            </div>
          </div>
          <div className="st-transport">
            <span data-testid="studio-frame">
              {seconds(frame)} / {seconds(project.durationFrames)}
            </span>
            <DraftInput
              aria-label="播放头帧"
              type="range"
              min={0}
              max={project.durationFrames - 1}
              value={Math.min(frame, project.durationFrames - 1)}
              onChange={(e) => seek(Number(e.target.value))}
            />
            <button onClick={() => seek(0)}>回到开头</button>
          </div>
          <div className="st-toolstrip">
            <div role="tablist" aria-label="创作工具">
              {(
                [
                  ["timeline", "多轨时间线"],
                  ["captions", "字幕"],
                  ["jobs", "导出任务"],
                ] as const
              ).map(([id, label]) => (
                <button
                  role="tab"
                  aria-selected={tab === id}
                  key={id}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="st-row">
              <button
                disabled={!history.current.canUndo}
                onClick={() => undo()}
              >
                撤销
              </button>
              <button
                disabled={!history.current.canRedo}
                onClick={() => undo(true)}
              >
                重做
              </button>
            </div>
          </div>
          {tab === "timeline" && (
            <section className="st-timeline" aria-label="多轨时间线">
              <div className="st-timeline-actions">
                <span>拖动片段移动 · 选中后方向键微调 · 上方图层覆盖下方</span>
                <button
                  disabled={
                    !selectedShot ||
                    !inSelected ||
                    frame === selectedShot.startFrame ||
                    project.shots.length >= 24
                  }
                  onClick={() => {
                    const id = uid();
                    commit((p) => splitShot(p, selection.id, frame, id));
                    select({ kind: "shot", id });
                  }}
                >
                  在播放头分割
                </button>
              </div>
              <div className="st-track-row">
                <span>时间 / 秒</span>
                <div
                  className="st-ruler"
                  onClick={(e) => {
                    const box = e.currentTarget.getBoundingClientRect();
                    seek(
                      ((e.clientX - box.left) / box.width) *
                        project.durationFrames,
                    );
                  }}
                >
                  {Array.from({ length: 6 }, (_, i) => (
                    <span key={i}>
                      {(((project.durationFrames / 30) * i) / 5).toFixed(1)}
                    </span>
                  ))}
                </div>
              </div>
              <div
                className="st-track-list"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const recipe = e.dataTransfer.getData(
                    "application/nexus-recipe",
                  );
                  if (!["hero", "tunnel", "layers"].includes(recipe)) return;
                  const rect = e.currentTarget
                    .querySelector(".st-lane")
                    ?.getBoundingClientRect();
                  if (rect)
                    addShot(
                      recipe as "hero" | "tunnel" | "layers",
                      Math.max(
                        0,
                        Math.min(
                          project.durationFrames - 1,
                          Math.round(
                            ((e.clientX - rect.left) / rect.width) *
                              project.durationFrames,
                          ),
                        ),
                      ),
                    );
                }}
              >
                {[...project.shots].reverse().map((s) => (
                  <div className="st-track-row" key={s.id}>
                    <span>
                      {s.enabled ? "◉" : "○"} {recipeName(s)}
                    </span>
                    <div className="st-lane">
                      {clipBar(
                        s.id,
                        "shot",
                        s.startFrame,
                        s.durationFrames,
                        s.params.headline,
                      )}
                      <i
                        className="st-playhead"
                        style={{
                          left: (frame / project.durationFrames) * 100 + "%",
                        }}
                      />
                    </div>
                  </div>
                ))}
                {project.audio.map((a) => (
                  <div className="st-track-row" key={a.id}>
                    <span>
                      {a.muted ? "○" : "♫"}{" "}
                      {a.kind === "music" ? "配乐" : "音效"}
                    </span>
                    <div className="st-lane">
                      {clipBar(
                        a.id,
                        "audio",
                        a.startFrame,
                        a.durationFrames,
                        (a.assetId
                          ? assets.find((v) => v.id === a.assetId)?.name
                          : null) ?? audioNames[a.builtin],
                      )}
                      <i
                        className="st-playhead"
                        style={{
                          left: (frame / project.durationFrames) * 100 + "%",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="st-row">
                <button
                  disabled={project.audio.length >= 24}
                  onClick={() => addAudio("music")}
                >
                  ＋ 配乐轨
                </button>
                <button
                  disabled={project.audio.length >= 24}
                  onClick={() => addAudio("sfx")}
                >
                  ＋ 音效轨
                </button>
                <span className="st-muted">
                  图片图层展示需要分别上传图层文件。
                </span>
              </div>
            </section>
          )}
          {tab === "captions" && (
            <section className="st-caption-panel">
              <CaptionEditor
                track={project.captions}
                duration={project.durationFrames / 30}
                musicEnabled={project.audio.some(
                  (a) => a.kind === "music" && !a.muted,
                )}
                sfx={project.audio
                  .filter((a) => a.kind === "sfx")
                  .map((a) => ({ type: a.builtin, time: a.startFrame / 30 }))}
                player={player}
                incoming={null}
                onChange={(track) =>
                  commit((p) => {
                    p.captions = track;
                  })
                }
              />
            </section>
          )}
          {tab === "jobs" && (
            <section className="st-jobs">
              {!jobs.length && (
                <p>还没有渲染任务。右上角“导出 MP4”会提交当前工程快照。</p>
              )}
              {jobs.map((j) => (
                <article key={j.id}>
                  <div>
                    <strong>{j.name}</strong>
                    <small>
                      {j.id.slice(0, 8)} · {jobNames[j.status] ?? j.status}
                      {j.elapsedSeconds
                        ? " · " + j.elapsedSeconds.toFixed(1) + "s"
                        : ""}
                    </small>
                    {j.error && <p role="alert">{j.error}</p>}
                  </div>
                  <progress max={1} value={j.progress} />
                  {j.downloadUrl && <a href={j.downloadUrl}>下载 MP4</a>}
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api("/api/studio/jobs/" + j.id, {
                          method: "DELETE",
                        });
                        setJobs(
                          (await api<{ jobs: Job[] }>("/api/studio/jobs")).jobs,
                        );
                      })
                    }
                  >
                    {["running", "queued"].includes(j.status)
                      ? "取消"
                      : "删除任务"}
                  </button>
                </article>
              ))}
            </section>
          )}
        </section>
        <aside className="st-inspector">
          <div className="st-section-head">
            <h2>片段属性</h2>
            <span>{selection.kind === "shot" ? "画面" : "声音"}</span>
          </div>
          {selectedShot && (
            <>
              <label>
                镜头标题
                <DraftInput
                  aria-label="镜头标题"
                  value={selectedShot.params.headline}
                  maxLength={32}
                  disabled={selectedShot.recipe === "legacy"}
                  onChange={(e) =>
                    patchShot((s) => {
                      s.params.headline = e.target.value;
                    }, "headline")
                  }
                />
              </label>
              <label>
                品牌
                <DraftInput
                  aria-label="品牌"
                  value={selectedShot.params.brand}
                  maxLength={40}
                  disabled={selectedShot.recipe === "legacy"}
                  onChange={(e) =>
                    patchShot((s) => {
                      s.params.brand = e.target.value;
                    }, "brand")
                  }
                />
              </label>
              <label>
                副标题
                <DraftTextarea
                  allowEmpty
                  aria-label="副标题"
                  value={selectedShot.params.subtitle}
                  maxLength={100}
                  disabled={selectedShot.recipe === "legacy"}
                  onChange={(e) =>
                    patchShot((s) => {
                      s.params.subtitle = e.target.value;
                    }, "subtitle")
                  }
                />
              </label>
              <label>
                品牌颜色
                <DraftInput
                  aria-label="品牌颜色"
                  type="color"
                  value={selectedShot.params.accent}
                  disabled={selectedShot.recipe === "legacy"}
                  onChange={(e) =>
                    patchShot((s) => {
                      s.params.accent = e.target.value;
                    }, "accent")
                  }
                />
              </label>
              <label>
                关键词（每行一个）
                <DraftTextarea
                  aria-label="关键词"
                  value={selectedShot.params.keywords.join("\n")}
                  disabled={selectedShot.recipe === "legacy"}
                  onChange={(e) =>
                    patchShot((s) => {
                      s.params.keywords = e.target.value
                        .split("\n")
                        .filter(Boolean)
                        .slice(0, 24);
                    }, "keywords")
                  }
                />
              </label>
              <div className="st-grid2">
                <label>
                  开始帧
                  <DraftInput
                    aria-label="镜头开始帧"
                    type="number"
                    min={0}
                    max={project.durationFrames - selectedShot.durationFrames}
                    value={selectedShot.startFrame}
                    onChange={(e) =>
                      setClipStart(
                        selectedShot.id,
                        "shot",
                        Number(e.target.value),
                      )
                    }
                  />
                </label>
                <label>
                  持续帧
                  <DraftInput
                    aria-label="镜头持续帧"
                    type="number"
                    min={1}
                    max={Math.min(
                      selectedShot.sourceDurationFrames -
                        selectedShot.sourceInFrame,
                      project.durationFrames - selectedShot.startFrame,
                    )}
                    value={selectedShot.durationFrames}
                    onChange={(e) =>
                      patchShot((s) => {
                        s.durationFrames = Number(e.target.value);
                      })
                    }
                  />
                </label>
                <label>
                  源裁入帧
                  <DraftInput
                    aria-label="源裁入帧"
                    type="number"
                    min={0}
                    max={
                      selectedShot.sourceDurationFrames -
                      selectedShot.durationFrames
                    }
                    value={selectedShot.sourceInFrame}
                    onChange={(e) =>
                      patchShot((s) => {
                        s.sourceInFrame = Number(e.target.value);
                      })
                    }
                  />
                </label>
                <label>
                  源镜头总帧
                  <DraftInput
                    aria-label="源镜头总帧"
                    type="number"
                    min={
                      selectedShot.sourceInFrame + selectedShot.durationFrames
                    }
                    max={900}
                    value={selectedShot.sourceDurationFrames}
                    disabled={selectedShot.recipe === "legacy"}
                    onChange={(e) =>
                      patchShot((s) => {
                        s.sourceDurationFrames = Number(e.target.value);
                      })
                    }
                  />
                </label>
              </div>
              <label className="st-check">
                <DraftInput
                  type="checkbox"
                  checked={selectedShot.enabled}
                  onChange={(e) =>
                    patchShot((s) => {
                      s.enabled = e.target.checked;
                    })
                  }
                />
                显示镜头
              </label>
              <h3>图层变换</h3>
              <div className="st-grid2">
                {(["x", "y", "scale", "opacity"] as const).map((property) => (
                  <label key={property}>
                    {
                      {
                        x: "水平位置",
                        y: "垂直位置",
                        scale: "缩放",
                        opacity: "不透明度",
                      }[property]
                    }
                    <DraftInput
                      aria-label={"图层 " + property}
                      type="number"
                      step={
                        property === "scale" || property === "opacity"
                          ? 0.05
                          : 10
                      }
                      value={selectedShot.transform[property]}
                      onChange={(e) =>
                        patchShot((s) => {
                          s.transform[property] = Number(e.target.value);
                        }, "transform-" + property)
                      }
                    />
                  </label>
                ))}
              </div>
              <h3>
                关键帧 <small>源帧 {sourceFrame}</small>
              </h3>
              <div className="st-grid2">
                <select
                  aria-label="关键帧属性"
                  value={keyProperty}
                  onChange={(e) => {
                    const key = e.target.value as KeyProperty;
                    setKeyProperty(key);
                    setKeyValue(
                      transformAt(selectedShot, Math.max(0, sourceFrame))[key],
                    );
                  }}
                >
                  {["x", "y", "scale", "opacity"].map((k) => (
                    <option key={k} value={k}>
                      {propertyNames[k]}
                    </option>
                  ))}
                </select>
                <DraftInput
                  aria-label="关键帧值"
                  type="number"
                  step={0.05}
                  value={keyValue}
                  onChange={(e) => setKeyValue(Number(e.target.value))}
                />
              </div>
              <button
                disabled={!inSelected}
                onClick={() =>
                  patchShot((s) => {
                    s.keyframes = s.keyframes.filter(
                      (k) =>
                        !(
                          k.property === keyProperty && k.frame === sourceFrame
                        ),
                    );
                    s.keyframes.push({
                      property: keyProperty,
                      frame: sourceFrame,
                      value: keyValue,
                      easing: "smooth",
                    });
                  })
                }
              >
                在当前帧设置关键帧
              </button>
              <div className="st-keyframes">
                {[...selectedShot.keyframes]
                  .sort((a, b) => a.frame - b.frame)
                  .map((k) => (
                    <div key={k.property + k.frame}>
                      <button
                        onClick={() =>
                          seek(
                            selectedShot.startFrame +
                              k.frame -
                              selectedShot.sourceInFrame,
                          )
                        }
                      >
                        {propertyNames[k.property]} · {k.frame}f → {k.value}
                      </button>
                      <button
                        aria-label={"删除关键帧 " + k.property + " " + k.frame}
                        onClick={() =>
                          patchShot((s) => {
                            s.keyframes = s.keyframes.filter(
                              (a) =>
                                a.property !== k.property ||
                                a.frame !== k.frame,
                            );
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
              </div>
              <h3>
                图片顺序{" "}
                <small>{selectedShot.params.imageAssetIds.length}/6</small>
              </h3>
              {selectedShot.recipe === "legacy" ? (
                <p className="st-muted">
                  旧镜头保留原内容参数；可裁剪、移动、调整变换。原广告编辑器仍可使用。
                </p>
              ) : (
                selectedShot.params.imageAssetIds.map((id, index) => (
                  <div className="st-image-row" key={id + index}>
                    <img
                      src={"/api/assets/" + id}
                      alt={"镜头图片 " + (index + 1)}
                    />
                    <button
                      disabled={!index}
                      aria-label={"前移图片 " + (index + 1)}
                      onClick={() =>
                        patchShot((s) => {
                          const ids = s.params.imageAssetIds;
                          [ids[index - 1], ids[index]] = [
                            ids[index],
                            ids[index - 1],
                          ];
                        })
                      }
                    >
                      ↑
                    </button>
                    <button
                      aria-label={"移除图片 " + (index + 1)}
                      onClick={() =>
                        patchShot((s) => {
                          s.params.imageAssetIds.splice(index, 1);
                        })
                      }
                    >
                      移除
                    </button>
                  </div>
                ))
              )}
              <div className="st-row">
                <button
                  disabled={project.shots.length >= 24}
                  onClick={() => {
                    const id = uid();
                    commit((p) => {
                      const s = structuredClone(selectedShot);
                      s.id = id;
                      p.shots.push(s);
                    });
                    select({ kind: "shot", id });
                  }}
                >
                  复制
                </button>
                <button
                  disabled={project.shots.length <= 1}
                  onClick={() => {
                    commit((p) => {
                      p.shots = p.shots.filter((s) => s.id !== selection.id);
                    });
                    select({
                      kind: "shot",
                      id: history.current.current.shots[0].id,
                    });
                  }}
                >
                  删除镜头
                </button>
              </div>
              <button
                disabled={project.shots.at(-1)?.id === selectedShot.id}
                onClick={() =>
                  commit((p) => {
                    const i = p.shots.findIndex(
                      (s) => s.id === selectedShot.id,
                    );
                    [p.shots[i], p.shots[i + 1]] = [p.shots[i + 1], p.shots[i]];
                  })
                }
              >
                提高一层
              </button>
            </>
          )}
          {selectedAudio && (
            <>
              <label>
                开始帧
                <DraftInput
                  aria-label="声音开始帧"
                  type="number"
                  value={selectedAudio.startFrame}
                  onChange={(e) =>
                    setClipStart(
                      selectedAudio.id,
                      "audio",
                      Number(e.target.value),
                    )
                  }
                />
              </label>
              <label>
                持续帧
                <DraftInput
                  aria-label="声音持续帧"
                  type="number"
                  min={1}
                  max={project.durationFrames - selectedAudio.startFrame}
                  value={selectedAudio.durationFrames}
                  onChange={(e) =>
                    commit((p) => {
                      p.audio.find(
                        (a) => a.id === selectedAudio.id,
                      )!.durationFrames = Number(e.target.value);
                    })
                  }
                />
              </label>
              <label>
                音量 {Math.round(selectedAudio.gain * 100)}%
                <DraftInput
                  aria-label="声音音量"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={selectedAudio.gain}
                  onChange={(e) =>
                    commit((p) => {
                      p.audio.find((a) => a.id === selectedAudio.id)!.gain =
                        Number(e.target.value);
                    }, "gain")
                  }
                />
              </label>
              <label className="st-check">
                <DraftInput
                  aria-label="声音静音"
                  type="checkbox"
                  checked={selectedAudio.muted}
                  onChange={(e) =>
                    commit((p) => {
                      p.audio.find((a) => a.id === selectedAudio.id)!.muted =
                        e.target.checked;
                    })
                  }
                />
                静音此片段
              </label>
              {!selectedAudio.assetId && (
                <label>
                  内置声音
                  <select
                    aria-label="内置声音"
                    value={selectedAudio.builtin}
                    onChange={(e) =>
                      commit((p) => {
                        p.audio.find(
                          (a) => a.id === selectedAudio.id,
                        )!.builtin = e.target.value as
                          | "pulse"
                          | "whoosh"
                          | "impact"
                          | "click";
                      })
                    }
                  >
                    <option value="pulse">原创配乐</option>
                    <option value="whoosh">转场掠过</option>
                    <option value="impact">低频强调</option>
                    <option value="click">轻触声</option>
                  </select>
                </label>
              )}
              <button
                onClick={() => {
                  commit((p) => {
                    p.audio = p.audio.filter((a) => a.id !== selectedAudio.id);
                  });
                  select({ kind: "shot", id: project.shots[0].id });
                }}
              >
                删除声音片段
              </button>
            </>
          )}
          {!selectedShot && !selectedAudio && <p>在时间线选择一个片段。</p>}
          <hr />
          <h3>工程与输出</h3>
          <label>
            工程总帧数（每秒30帧）
            <DraftInput
              aria-label="工程总帧数"
              type="number"
              min={30}
              max={900}
              value={project.durationFrames}
              onChange={(e) =>
                commit((p) => {
                  p.durationFrames = Number(e.target.value);
                })
              }
            />
          </label>
          <label>
            MP4 分辨率
            <select
              aria-label="导出分辨率"
              value={resolution}
              onChange={(e) =>
                setResolution(e.target.value as "720p" | "1080p")
              }
            >
              <option value="720p">1280 × 720 · 快速验证</option>
              <option value="1080p">1920 × 1080 · 高清成片</option>
            </select>
          </label>
          <button
            className="st-primary"
            disabled={!ready || busy}
            onClick={() => void submit()}
          >
            生成带声 MP4
          </button>
          <button
            disabled={!record || busy}
            onClick={() =>
              void run(async () => {
                setVersions(
                  (
                    await api<{ versions: number[] }>(
                      "/api/studio/projects/" + record!.id + "/versions",
                    )
                  ).versions,
                );
              })
            }
          >
            查看已保存版本
          </button>
          {versions.length > 0 && (
            <select
              aria-label="恢复历史版本为草稿"
              value=""
              onChange={(e) => {
                const revision = Number(e.target.value);
                if (revision && record && discard())
                  void run(async () => {
                    const data = await api<RecordData>(
                      "/api/studio/projects/" +
                        record.id +
                        "/versions/" +
                        revision,
                    );
                    history.current.reset(data.project);
                    setProject(history.current.current);
                    setSelection({
                      kind: "shot",
                      id: data.project.shots[0].id,
                    });
                    note(
                      "已载入历史 v" + revision + " 为草稿；保存会创建新版本。",
                    );
                  });
              }}
            >
              <option value="">选择历史版本载入草稿</option>
              {versions.map((v) => (
                <option key={v} value={v}>
                  版本 {v}
                </option>
              ))}
            </select>
          )}
          <p className="st-muted">
            首批支持单实例项目库与版本冲突保护，尚无多用户账户隔离。JSON
            备份不包含素材文件。
          </p>
        </aside>
      </div>
    </main>
  );
}
