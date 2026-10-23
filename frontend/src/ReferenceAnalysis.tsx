import { useEffect, useRef, useState } from "react";
import { api, message } from "./io";

type Report = {
  video: {
    duration: number;
    width: number;
    height: number;
    fps: number;
    codec: string;
  };
  audio: { codec: string; channels: number }[];
  frames: {
    index: number;
    time: number;
    file: string;
    ocrText: string | null;
  }[];
  speechFile: string | null;
  subtitleFile: string | null;
  warnings: string[];
  scope: string;
};
type ReferenceJob = {
  id: string;
  name: string;
  status: "uploading" | "analyzing" | "done" | "failed";
  progress: number;
  error?: string;
  report?: Report;
};
const labels = {
  uploading: "正在上传",
  analyzing: "正在解析",
  done: "解析完成",
  failed: "解析失败",
};
function timecode(seconds: number) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}
export function ReferenceAnalysis() {
  const [jobs, setJobs] = useState<ReferenceJob[]>([]);
  const [selected, setSelected] = useState<ReferenceJob | null>(null);
  const [status, setStatus] = useState(
    "上传参考视频，按时间抽帧并识别画面文字。",
  );
  const [error, setError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const request = useRef<XMLHttpRequest | null>(null);
  const selection = useRef<string | null>(null);
  const announced = useRef(new Set<string>());
  const mounted = useRef(false);
  const report = selected?.report;
  const fileURL = (name: string) =>
    `/api/references/${selected!.id}/files/${name}`;
  const note = (text: string, failed = false) => {
    if (!mounted.current) return;
    setStatus(text);
    setError(failed);
  };
  const accept = (job: ReferenceJob, announce = false) => {
    setSelected(job);
    if (
      ["done", "failed"].includes(job.status) &&
      (announce || !announced.current.has(job.id))
    ) {
      announced.current.add(job.id);
      note(
        job.status === "done"
          ? "解析完成，可核对时间点、画面文字和提取音轨。"
          : "解析失败：" + job.error,
        job.status === "failed",
      );
    }
  };
  const select = async (id: string) => {
    selection.current = id;
    setLoadingId(id);
    try {
      const job = await api<ReferenceJob>(`/api/references/${id}`);
      if (mounted.current && selection.current === id) accept(job, true);
    } catch (e) {
      note(message(e), true);
    } finally {
      if (mounted.current && selection.current === id) setLoadingId(null);
    }
  };
  useEffect(() => {
    mounted.current = true;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const data = await api<{ jobs: ReferenceJob[] }>("/api/references");
        if (!mounted.current) return;
        setJobs(data.jobs);
        const id = selection.current;
        if (id) {
          const current = data.jobs.find((j) => j.id === id);
          if (current) {
            const detail = await api<ReferenceJob>(`/api/references/${id}`);
            if (mounted.current && selection.current === id) accept(detail);
          }
        }
      } catch (e) {
        note("参考片记录读取失败：" + message(e), true);
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2500);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      request.current?.abort();
    };
  }, []);
  const upload = (video: File) => {
    if (video.size > 90 * 1024 * 1024) {
      note("参考片超过 90 MiB，请压缩或分段后上传。", true);
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    note("正在上传参考片，请保持页面打开。");
    const xhr = new XMLHttpRequest();
    request.current = xhr;
    xhr.open(
      "POST",
      "/api/references?filename=" + encodeURIComponent(video.name),
    );
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (mounted.current && event.lengthComputable)
        setUploadProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText);
        if (xhr.status !== 202)
          throw Error(
            typeof body.detail === "string"
              ? body.detail
              : `上传失败（HTTP ${xhr.status}）`,
          );
        if (!mounted.current) return;
        setJobs((previous) => [
          body,
          ...previous.filter((j) => j.id !== body.id),
        ]);
        void select(body.id);
        note("上传完成，服务器正在抽帧与识别画面文字。");
      } catch (e) {
        note(message(e), true);
      }
    };
    xhr.onerror = () => note("上传连接中断，请检查网络后重试。", true);
    xhr.timeout = 180000;
    xhr.ontimeout = () =>
      note("上传超过 3 分钟，请压缩视频或检查网络后重试。", true);
    xhr.onloadend = () => {
      if (mounted.current) setUploading(false);
      request.current = null;
    };
    xhr.send(video);
  };
  const active = jobs.some(
    (j) => j.status === "uploading" || j.status === "analyzing",
  );
  return (
    <section className="panel reference-analysis" aria-label="参考视频解析">
      <div className="timehead">
        <h2>参考视频解析</h2>
        <button
          disabled={uploading || active}
          onClick={() => file.current?.click()}
        >
          上传参考视频
        </button>
      </div>
      <p className="muted">
        MP4 / MOV / WebM / MKV / AVI / TS · 最大 90 MiB · 15 分钟以内 · 最高
        1080p。最多 48 张时间采样画面，其中最多 12 张识别中英文文字。
      </p>
      <input
        ref={file}
        data-testid="reference-upload"
        hidden
        type="file"
        accept="video/*,.mkv,.ts"
        onChange={(e) => {
          const video = e.target.files?.[0];
          if (video) upload(video);
          e.target.value = "";
        }}
      />
      <p
        className={error ? "reference-error" : "muted"}
        role={error ? "alert" : undefined}
        data-testid="reference-status"
      >
        {status}
      </p>
      {uploading && (
        <label>
          上传 {Math.round(uploadProgress * 100)}%{" "}
          <progress max="1" value={uploadProgress} />
        </label>
      )}
      {jobs.map((job) => (
        <div className="reference-job" key={job.id} data-testid="reference-job">
          <button
            onClick={() => void select(job.id)}
            aria-pressed={selected?.id === job.id}
          >
            {job.name}
          </button>
          <span>
            {labels[job.status]} {Math.round(job.progress * 100)}%
          </span>
          {!["uploading", "analyzing"].includes(job.status) && (
            <button
              onClick={async () => {
                try {
                  await api(`/api/references/${job.id}`, { method: "DELETE" });
                  if (!mounted.current) return;
                  setJobs((items) => items.filter((j) => j.id !== job.id));
                  if (selection.current === job.id) {
                    selection.current = null;
                    setSelected(null);
                  }
                  note("已删除该参考片的解析记录、截图与音频。");
                } catch (e) {
                  note(message(e), true);
                }
              }}
              aria-label={"删除参考片 " + job.name}
            >
              删除
            </button>
          )}
          {job.error && <p className="reference-error">{job.error}</p>}
        </div>
      ))}
      {loadingId && <p className="muted">正在读取解析详情…</p>}
      {selected && report && (
        <div className="reference-report" data-testid="reference-report">
          <h3>{selected.name}</h3>
          <p>
            {timecode(report.video.duration)} · {report.video.width} ×{" "}
            {report.video.height} · {report.video.fps} FPS ·{" "}
            {report.video.codec} ·{" "}
            {report.audio.length
              ? `${report.audio.length} 条音轨`
              : "原文件没有音轨"}
          </p>
          <p className="muted">{report.scope}</p>
          {report.warnings.map((warning) => (
            <p className="reference-error" key={warning}>
              {warning}
            </p>
          ))}
          <div className="row wrap">
            <a className="ad-back" href={fileURL("report.json")} download>
              下载解析 JSON
            </a>
            {report.subtitleFile && (
              <a
                className="ad-back"
                href={fileURL(report.subtitleFile)}
                download
              >
                下载内嵌字幕
              </a>
            )}
            {report.speechFile && (
              <a className="ad-back" href={fileURL(report.speechFile)} download>
                下载 16k 音轨
              </a>
            )}
          </div>
          {report.speechFile ? (
            <div className="reference-audio">
              <audio controls preload="none" src={fileURL(report.speechFile)} />
              <p className="muted">
                可试听提取音轨；语音识别尚未接入，当前没有讲解逐字稿。
              </p>
            </div>
          ) : (
            <p className="muted">
              没有可提取的声音，无法转写讲解或分析原片音效。
            </p>
          )}
          <div className="reference-frames">
            {report.frames.map((frame) => (
              <figure key={frame.index}>
                <a href={fileURL(frame.file)} target="_blank" rel="noreferrer">
                  <img
                    loading="lazy"
                    src={fileURL(frame.file)}
                    alt={"参考片 " + timecode(frame.time) + " 的画面"}
                  />
                </a>
                <figcaption>
                  <strong>{timecode(frame.time)}</strong>
                  {frame.ocrText && <pre>{frame.ocrText}</pre>}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
