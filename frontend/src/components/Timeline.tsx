import { Button, Range, type PanelProps } from "./controls";
export function Timeline({ editor, state }: PanelProps) {
  const disabled =
    state.busy || state.recording || state.rendererState !== "ready";
  return (
    <section className="timeline">
      <div className="timehead">
        <h2>06 / 时间轴</h2>
        <span>
          {state.project.fps} FPS ·{" "}
          <span id="keyCount">{state.project.keyframes.length}</span> KEYS
        </span>
      </div>
      <div className="row wrap">
        <Button
          action="add-key"
          disabled={disabled}
          onClick={() => editor.addKey()}
        >
          ＋ 主体关键帧
        </Button>
        <Button
          action="remove-key"
          disabled={disabled || !state.project.keyframes.length}
          onClick={() => editor.removeKey()}
        >
          删除末帧
        </Button>
      </div>
      <div className="track">
        <span>场景主体颜色／尺寸</span>
        <div
          className="trackbar"
          role="slider"
          aria-label="时间轴定位"
          aria-valuemin={0}
          aria-valuemax={state.project.duration}
          aria-valuenow={state.elapsed}
          aria-disabled={disabled}
          tabIndex={disabled ? -1 : 0}
          onPointerDown={(e) => {
            if (!disabled) {
              e.currentTarget.setPointerCapture(e.pointerId);
              const rect = e.currentTarget.getBoundingClientRect();
              editor.seek(
                ((e.clientX - rect.left) / rect.width) * state.project.duration,
              );
            }
          }}
          onPointerMove={(e) => {
            if (!disabled && e.currentTarget.hasPointerCapture(e.pointerId)) {
              const rect = e.currentTarget.getBoundingClientRect();
              editor.seek(
                ((e.clientX - rect.left) / rect.width) * state.project.duration,
              );
            }
          }}
          onKeyDown={(e) => {
            if (!disabled && ["ArrowLeft", "ArrowRight"].includes(e.key)) {
              e.preventDefault();
              editor.seek(state.elapsed + (e.key === "ArrowLeft" ? -0.1 : 0.1));
            }
          }}
        >
          <div className="clip" />
          {state.project.keyframes.map((key) => (
            <span
              className="key-marker"
              key={key.t}
              style={{ left: (key.t / state.project.duration) * 100 + "%" }}
            />
          ))}
          <div
            className="playhead"
            style={{
              left: (state.elapsed / state.project.duration) * 100 + "%",
            }}
          />
        </div>
      </div>
      <p id="keyList" className="muted">
        {state.project.keyframes.length
          ? state.project.keyframes
              .map(
                (k) =>
                  `${k.t.toFixed(1)}s / ${k.scale.toFixed(1)}× / ${k.color}`,
              )
              .join(" · ")
          : "尚未创建场景主体关键帧"}
      </p>
      <p className="muted">
        图片／3D 对象当前是静态变换；相机关键帧尚未实现。主音效触发：
        {editor.cue.assetId ? editor.cue.time + " 秒" : "未选择"}。
      </p>
      <Range
        id="scrub"
        label="预览定位"
        min={0}
        max={state.project.duration}
        step={0.01}
        value={state.elapsed}
        disabled={disabled}
        onChange={(n) => editor.seek(n)}
        format={(n) => n.toFixed(1) + " s"}
      />
    </section>
  );
}
