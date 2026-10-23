import { useEffect, useRef, useState, type RefObject } from "react";
import type { PlayerRef } from "@remotion/player";
import type { Caption } from "@remotion/captions";
import {
  captionTrackSchema,
  fitCaptions,
  parseSubtitleFile,
  serializeSrt,
  type CaptionTrack,
} from "../../video/captions";
import { download, message } from "./io";

export type CaptionImport = { text: string; name: string; key: number };
type Preview = ReturnType<typeof fitCaptions> & { name: string };
type Props = {
  track: CaptionTrack;
  duration: number;
  musicEnabled: boolean;
  sfx: { type: string; time: number }[];
  player: RefObject<PlayerRef | null>;
  incoming: CaptionImport | null;
  onChange: (track: CaptionTrack) => void;
};
export function CaptionEditor({
  track,
  duration,
  musicEnabled,
  sfx,
  player,
  incoming,
  onChange,
}: Props) {
  const [frame, setFrame] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [sourceStart, setSourceStart] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [status, setStatus] = useState(
    "导入已有字幕或手动添加；字幕将真实烧录进导出视频。",
  );
  const [error, setError] = useState(false);
  const lastImport = useRef<CaptionTrack | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const source = useRef<{ text: string; name: string } | null>(null);
  const note = (text: string, failed = false) => {
    setStatus(text);
    setError(failed);
  };
  const validation = captionTrackSchema.safeParse(track);
  const invalid = !validation.success
    ? validation.error.issues.map((v) => v.message).join("；")
    : track.cues.some((cue) => cue.endMs > duration * 1000)
      ? "字幕超过工程时长，请调整时间或裁到工程时长。"
      : "";
  const seek = (next: number) => {
    const target = Math.max(0, Math.min(duration * 30 - 1, Math.round(next)));
    player.current?.pause();
    player.current?.seekTo(target);
    setFrame(target);
  };
  useEffect(() => {
    const current = player.current;
    if (!current) return;
    const update = (event: { detail: { frame: number } }) =>
      setFrame(event.detail.frame);
    current.addEventListener("frameupdate", update);
    setFrame(current.getCurrentFrame());
    return () => current.removeEventListener("frameupdate", update);
  }, [player]);
  const prepare = (text: string, name: string, start: number) => {
    source.current = { text, name };
    setPreview(null);
    try {
      const result = fitCaptions(
        parseSubtitleFile(text),
        Math.round(start * 1000),
        duration * 1000,
      );
      if (!result.cues.length)
        throw Error("所选时间范围内没有字幕，请调整参考字幕起点。");
      setPreview({ ...result, name });
      note("请核对下方导入预览，再应用到字幕轨。原字幕轨暂时保留。");
    } catch (e) {
      note(message(e), true);
    }
  };
  useEffect(() => {
    if (incoming) {
      setSourceStart(0);
      prepare(incoming.text, incoming.name, 0);
    }
  }, [incoming]);
  useEffect(() => {
    // A preview belongs to the duration and source window it was prepared for.
    setPreview(null);
  }, [duration]);
  const replaceCue = (index: number, patch: Partial<Caption>) =>
    onChange({
      ...track,
      cues: track.cues.map((cue, i) =>
        i === index ? { ...cue, ...patch, timestampMs: null } : cue,
      ),
    });
  const add = () => {
    let startMs = Math.floor((frame / 30) * 1000),
      endMs = duration * 1000;
    for (const cue of track.cues) {
      if (cue.endMs <= startMs) continue;
      if (cue.startMs >= startMs + 100) {
        endMs = cue.startMs;
        break;
      }
      startMs = cue.endMs;
    }
    endMs = Math.min(endMs, startMs + 2000);
    if (endMs - startMs < 100) {
      note("当前游标后没有空余字幕时间，请先定位到空档。", true);
      return;
    }
    const cue: Caption = {
      text: "输入广告字幕",
      startMs,
      endMs,
      timestampMs: null,
      confidence: null,
    };
    const cues = [...track.cues, cue].sort((a, b) => a.startMs - b.startMs);
    onChange({ ...track, enabled: true, cues });
    setSelected(cues.indexOf(cue));
    seek(Math.ceil((startMs * 30) / 1000));
    note("已在空档添加字幕，可编辑文字和时间。");
  };
  return (
    <section
      id="caption-editor"
      className="panel ad-captions"
      aria-label="字幕轨与时间轴"
    >
      <h2>字幕轨与时间轴</h2>
      <p className="muted">
        字幕、背景音乐和音效按同一工程时间预览；字幕不是语音识别结果。每条最多
        80 字、三行，最多 50
        条，禁止时间重叠。较长字幕自动折行或缩小，画面为字幕预留安全区。
      </p>
      <label className="check">
        <input
          type="checkbox"
          data-testid="captions-enabled"
          checked={track.enabled}
          onChange={(e) => onChange({ ...track, enabled: e.target.checked })}
        />
        启用字幕轨
      </label>
      <div className="row wrap">
        <button onClick={() => file.current?.click()}>导入 SRT／VTT</button>
        <button
          disabled={!!invalid || !track.cues.length}
          onClick={() =>
            download(
              new Blob([serializeSrt(track.cues)], {
                type: "text/plain;charset=utf-8",
              }),
              "nexus-ad-captions.srt",
            )
          }
        >
          导出 SRT
        </button>
        <button
          disabled={!!invalid || track.cues.length >= 50}
          data-testid="caption-add"
          onClick={add}
        >
          在游标后添加字幕
        </button>
        {lastImport.current && (
          <button
            onClick={() => {
              onChange(structuredClone(lastImport.current!));
              lastImport.current = null;
              setSelected(null);
              note("已撤回最近一次字幕导入。");
            }}
          >
            撤回上次导入
          </button>
        )}
        {track.cues.some((cue) => cue.endMs > duration * 1000) && (
          <button
            onClick={() => {
              try {
                const result = fitCaptions(track.cues, 0, duration * 1000);
                onChange({ ...track, cues: result.cues });
                setSelected(null);
                note(
                  `已截短 ${result.clipped} 条、移除窗口外 ${result.dropped} 条字幕。`,
                );
              } catch (e) {
                note(message(e), true);
              }
            }}
          >
            裁到工程时长
          </button>
        )}
      </div>
      <input
        hidden
        type="file"
        ref={file}
        data-testid="caption-upload"
        accept=".srt,.vtt,text/vtt"
        onChange={async (e) => {
          const chosen = e.target.files?.[0];
          e.target.value = "";
          if (!chosen) return;
          if (chosen.size > 128 * 1024) {
            note("字幕文件超过 128 KiB", true);
            return;
          }
          try {
            prepare(await chosen.text(), chosen.name, sourceStart);
          } catch (err) {
            note(message(err), true);
          }
        }}
      />
      <div className="ad-two">
        <label>
          参考字幕起点 / 秒
          <input
            type="number"
            min="0"
            max="86400"
            step=".1"
            value={sourceStart}
            onChange={(e) => {
              setSourceStart(Math.max(0, Number(e.target.value)));
              setPreview(null);
            }}
          />
        </label>
        <button
          disabled={!source.current}
          onClick={() =>
            source.current &&
            prepare(source.current.text, source.current.name, sourceStart)
          }
        >
          按当前起点重新预览导入
        </button>
      </div>
      <p
        className={error ? "reference-error" : "muted"}
        role={error ? "alert" : undefined}
        data-testid="caption-status"
      >
        {status}
      </p>
      {preview && (
        <div
          className="caption-import-preview"
          data-testid="caption-import-preview"
        >
          <strong>
            {preview.name}：{preview.cues.length} 条，跳过窗口外{" "}
            {preview.dropped} 条，截短 {preview.clipped} 条
          </strong>
          <p className="muted">
            截取参考字幕 {sourceStart.toFixed(1)}–
            {(sourceStart + duration).toFixed(1)} 秒，映射到本广告 0–{duration}{" "}
            秒。只替换字幕内容；画面、音乐和音效保留。
          </p>
          <ol>
            {preview.cues.slice(0, 5).map((cue, i) => (
              <li key={i}>
                {(cue.startMs / 1000).toFixed(2)}–
                {(cue.endMs / 1000).toFixed(2)}s：{cue.text}
              </li>
            ))}
          </ol>
          <div className="row wrap">
            <button
              className="primary"
              data-testid="caption-apply-import"
              onClick={() => {
                lastImport.current = structuredClone(track);
                onChange({ ...track, enabled: true, cues: preview.cues });
                setSelected(0);
                seek(Math.ceil((preview.cues[0].startMs * 30) / 1000));
                setPreview(null);
                note("字幕已应用到工程；可预览、编辑，再保存到云端。");
              }}
            >
              应用这批字幕
            </button>
            <button onClick={() => setPreview(null)}>取消导入</button>
          </div>
        </div>
      )}
      {invalid && (
        <p
          role="alert"
          className="reference-error"
          data-testid="caption-validation"
        >
          {invalid} 修正后可保存和渲染。
        </p>
      )}
      <div className="ad-three">
        <label>
          字幕样式
          <select
            value={track.style}
            onChange={(e) =>
              onChange({
                ...track,
                style: e.target.value as CaptionTrack["style"],
              })
            }
          >
            <option value="plain">清晰描影</option>
            <option value="tech">科技面板</option>
            <option value="pop">弹入强调</option>
          </select>
        </label>
        <label>
          字幕位置
          <select
            value={track.position}
            onChange={(e) =>
              onChange({
                ...track,
                position: e.target.value as CaptionTrack["position"],
              })
            }
          >
            <option value="bottom">底部安全区</option>
            <option value="top">顶部安全区</option>
          </select>
        </label>
        <label>
          字号上限 {track.fontSize}
          <input
            type="range"
            min="32"
            max="80"
            value={track.fontSize}
            onChange={(e) =>
              onChange({ ...track, fontSize: Number(e.target.value) })
            }
          />
        </label>
        <label>
          字幕颜色
          <input
            type="color"
            value={track.color}
            onChange={(e) => onChange({ ...track, color: e.target.value })}
          />
        </label>
      </div>
      <label>
        播放位置 {(frame / 30).toFixed(2)} / {duration.toFixed(2)} 秒
        <input
          aria-label="广告时间轴游标"
          data-testid="caption-scrub"
          type="range"
          min="0"
          max={duration * 30 - 1}
          step="1"
          value={Math.min(frame, duration * 30 - 1)}
          onChange={(e) => seek(Number(e.target.value))}
        />
      </label>
      <div className="caption-timeline">
        <div className="caption-lane">
          <span>字幕</span>
          <div>
            {track.cues.map((cue, index) => (
              <button
                key={index}
                data-testid="caption-clip"
                aria-label={`定位字幕 ${index + 1}`}
                className={selected === index ? "selected" : ""}
                style={{
                  left: `${(cue.startMs / (duration * 1000)) * 100}%`,
                  width: `${Math.max(0.2, ((cue.endMs - cue.startMs) / (duration * 1000)) * 100)}%`,
                }}
                onClick={() => {
                  setSelected(index);
                  seek(Math.ceil((cue.startMs / 1000) * 30));
                }}
              >
                {cue.text}
              </button>
            ))}
          </div>
        </div>
        <div className="caption-lane">
          <span>音乐</span>
          <div>
            <span className={"caption-music " + (musicEnabled ? "" : "off")}>
              {musicEnabled ? "背景音乐已启用" : "背景音乐已关闭"}
            </span>
          </div>
        </div>
        <div className="caption-lane">
          <span>音效</span>
          <div>
            {sfx.map((cue, index) => (
              <button
                key={index}
                aria-label={`定位音效 ${index + 1}`}
                style={{
                  left: `${(cue.time / duration) * 100}%`,
                  width: "18px",
                }}
                onClick={() => seek(cue.time * 30)}
                title={`${cue.type} / ${cue.time}s`}
              >
                ◆
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="caption-list">
        {track.cues.map((cue, index) => (
          <div
            key={index}
            className={"caption-cue " + (selected === index ? "selected" : "")}
            data-testid="caption-cue"
          >
            <button
              onClick={() => {
                setSelected(index);
                seek(Math.ceil((cue.startMs / 1000) * 30));
              }}
              aria-label={`预览字幕 ${index + 1}`}
            >
              {index + 1} ▶
            </button>
            <label>
              开始秒
              <input
                aria-label={`字幕开始 ${index + 1}`}
                type="number"
                min="0"
                max={duration}
                step=".01"
                value={cue.startMs / 1000}
                onChange={(e) =>
                  replaceCue(index, {
                    startMs: Math.round(Number(e.target.value) * 1000),
                  })
                }
              />
            </label>
            <label>
              结束秒
              <input
                aria-label={`字幕结束 ${index + 1}`}
                type="number"
                min="0"
                max={duration}
                step=".01"
                value={cue.endMs / 1000}
                onChange={(e) =>
                  replaceCue(index, {
                    endMs: Math.round(Number(e.target.value) * 1000),
                  })
                }
              />
            </label>
            <textarea
              aria-label={`字幕正文 ${index + 1}`}
              maxLength={80}
              value={cue.text}
              onChange={(e) => replaceCue(index, { text: e.target.value })}
            />
            <button
              aria-label={`删除字幕 ${index + 1}`}
              onClick={() => {
                onChange({
                  ...track,
                  cues: track.cues.filter((_, i) => i !== index),
                });
                setSelected(null);
              }}
            >
              删除
            </button>
          </div>
        ))}
        {!track.cues.length && (
          <p className="muted">
            字幕轨为空。导入已有字幕，或在游标后的空档添加。
          </p>
        )}
      </div>
    </section>
  );
}
