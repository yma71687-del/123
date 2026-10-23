import { type SceneObject } from "../schema";
import { Button, NumberField, Range, type PanelProps } from "./controls";
export function Inspector({ editor, state }: PanelProps) {
  const selected = state.project.objects.find((o) => o.id === state.selectedId),
    disabled = state.busy || state.recording || state.dragging;
  const error = (value: string) => editor.notify(value, "err");
  const edit = (patch: Partial<SceneObject>, mergeKey?: string) => {
    if (selected)
      editor.run(() => editor.editObject(selected.id, patch, mergeKey));
  };
  return (
    <aside className="panel inspector">
      <details open>
        <summary>03 / 对象检查器</summary>
        <div className="section-content">
          {selected ? (
            <div id="objectInspector" data-selected-id={selected.id}>
              <label className="field">
                对象名称
                <input
                  id="objectName"
                  value={selected.name}
                  maxLength={160}
                  disabled={disabled}
                  onChange={(e) => edit({ name: e.target.value }, "name")}
                />
              </label>
              <div
                className="row wrap tools"
                role="group"
                aria-label="对象变换模式"
              >
                {(["translate", "rotate", "scale"] as const).map((mode, i) => (
                  <Button
                    key={mode}
                    action={"transform-" + mode}
                    aria-pressed={state.transformMode === mode}
                    disabled={disabled || state.rendererState !== "ready"}
                    className={state.transformMode === mode ? "active" : ""}
                    onClick={() => editor.setTransformMode(mode)}
                  >
                    {["移动 W", "旋转 E", "缩放 R"][i]}
                  </Button>
                ))}
              </div>
              <p className="muted">
                拖动视口中的轴柄，或输入数值。旋转以度显示。每次拖动只记一次历史。
              </p>
              {(["position", "rotation", "scale"] as const).map(
                (group, groupIndex) => (
                  <fieldset
                    className="transform-group"
                    key={group}
                    disabled={disabled}
                  >
                    <legend>
                      {["位置", "旋转（度）", "缩放"][groupIndex]}
                    </legend>
                    <div className="vector-fields">
                      {(["x", "y", "z"] as const).map((axis) => {
                        const key = (
                            group === "position"
                              ? axis
                              : group === "rotation"
                                ? "r" + axis
                                : "s" + axis
                          ) as keyof SceneObject,
                          value = selected[key] as number,
                          factor = group === "rotation" ? 180 / Math.PI : 1;
                        return (
                          <NumberField
                            key={axis}
                            id={"object-" + key}
                            label={axis.toUpperCase()}
                            value={value * factor}
                            min={
                              group === "position"
                                ? -20
                                : group === "rotation"
                                  ? -3600
                                  : 0.05
                            }
                            max={
                              group === "position"
                                ? 20
                                : group === "rotation"
                                  ? 3600
                                  : 10
                            }
                            step={group === "rotation" ? 5 : 0.1}
                            onCommit={(number) =>
                              edit({ [key]: number / factor })
                            }
                            onError={error}
                          />
                        );
                      })}
                    </div>
                  </fieldset>
                ),
              )}
              {selected.kind === "text" && (
                <label className="field">
                  标题内容
                  <input
                    id="objectText"
                    maxLength={160}
                    value={selected.text}
                    disabled={disabled}
                    onChange={(e) => edit({ text: e.target.value }, "text")}
                  />
                </label>
              )}
              {selected.kind !== "image" && (
                <label className="field" htmlFor="objectColor">
                  对象颜色
                  <input
                    id="objectColor"
                    type="color"
                    value={selected.color}
                    disabled={disabled}
                    onChange={(e) => edit({ color: e.target.value }, "color")}
                  />
                </label>
              )}
              <Range
                id="objectOpacity"
                label="对象透明度"
                value={selected.opacity}
                min={0}
                max={1}
                disabled={disabled}
                onChange={(opacity) => edit({ opacity }, "opacity")}
                format={(n) => Math.round(n * 100) + "%"}
              />
              <label className="check">
                <input
                  id="objectVisible"
                  type="checkbox"
                  checked={selected.visible}
                  disabled={disabled}
                  onChange={(e) => edit({ visible: e.target.checked })}
                />
                在画面中显示
              </label>
              <div className="row wrap">
                <Button
                  action="duplicate-object"
                  disabled={disabled}
                  onClick={() => editor.run(() => editor.duplicateSelected())}
                >
                  复制对象
                </Button>
                <Button
                  action="delete-object"
                  className="danger"
                  disabled={disabled}
                  onClick={() => editor.deleteSelected()}
                >
                  删除对象
                </Button>
              </div>
            </div>
          ) : (
            <p className="muted">
              点击视口中的对象，或从对象树选择。场景装饰不在对象树中。
            </p>
          )}
        </div>
      </details>
      <details open>
        <summary>04 / 工程与场景参数</summary>
        <div className="section-content">
          <label className="field" htmlFor="objname">
            工程名称
            <input
              id="objname"
              value={state.project.name}
              maxLength={160}
              disabled={disabled}
              onChange={(e) => editor.setTitle(e.target.value)}
            />
          </label>
          <label className="field" htmlFor="aspect">
            横版画幅 <output id="aspectOut">{state.project.aspect}</output>
            <select
              id="aspect"
              value={state.project.aspect}
              disabled={disabled}
              onChange={(e) =>
                editor.run(() =>
                  editor.setAspect(
                    e.target.value as typeof state.project.aspect,
                  ),
                )
              }
            >
              <option value="16:9">16:9 横版广告</option>
              <option value="2.39:1">2.39:1 电影宽银幕</option>
              <option value="4:3">4:3 经典横版</option>
            </select>
          </label>
          <label className="field" htmlFor="color">
            <span>
              场景主体颜色{" "}
              <output id="colorOut">
                {state.project.object.color.toUpperCase()}
              </output>
            </span>
            <input
              id="color"
              type="color"
              value={state.project.object.color}
              disabled={disabled}
              onChange={(e) => editor.setEffect("color", e.target.value)}
            />
          </label>
          {(["speed", "scale", "opacity", "ring"] as const).map((key, i) => (
            <Range
              key={key}
              id={key}
              label={
                [
                  "动画速度",
                  "场景主体尺寸",
                  "场景主体透明度",
                  "能量环强度（能量／全息）",
                ][i]
              }
              value={state.project.object[key]}
              min={[0, 0.4, 0.2, 0][i]}
              max={[3, 2, 1, 1][i]}
              disabled={
                disabled ||
                (key === "ring" &&
                  !["energy", "holo"].includes(state.project.template))
              }
              onChange={(n) => editor.setEffect(key, n)}
            />
          ))}
          <p className="muted">
            当前关键帧只驱动场景主体的颜色／尺寸。自由对象和相机的多轨关键帧尚未实现。
          </p>
        </div>
      </details>
      <details open>
        <summary>05 / 主音效与预览输出</summary>
        <div className="section-content">
          <label className="field" htmlFor="audioAsset">
            音频素材
            <select
              id="audioAsset"
              value={editor.cue.assetId ?? ""}
              disabled={disabled}
              onChange={(e) =>
                editor.setCue({ assetId: e.target.value || null })
              }
            >
              <option value="">未选择音频</option>
              {state.project.assets
                .filter(
                  (a) =>
                    a.contentType.startsWith("audio/") ||
                    /\.(wav|mp3|ogg|m4a|aac|flac)$/i.test(a.name),
                )
                .map((a) => (
                  <option value={a.id} key={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
          <NumberField
            id="soundtime"
            label="触发时间（秒）"
            value={editor.cue.time}
            min={0}
            max={state.project.duration}
            disabled={disabled}
            onCommit={(time) => editor.run(() => editor.setCue({ time }))}
            onError={error}
          />
          <Range
            id="volume"
            label="音量"
            value={editor.cue.volume}
            min={0}
            max={1}
            disabled={disabled}
            onChange={(volume) => editor.setCue({ volume }, "volume")}
            format={(n) => Math.round(n * 100) + "%"}
          />
          <Button
            action="preview-audio"
            disabled={disabled || !editor.cue.assetId}
            onClick={() => editor.run(() => editor.previewAudio())}
          >
            试听所选音频
          </Button>
          <p id="audioState" className="muted">
            {state.audioState}
          </p>
          <Button
            action="download-preview"
            className="primary wide"
            disabled={disabled || !editor.recorderSupported}
            title="无声画布预览；不包含音轨或编辑辅助线"
            onClick={() =>
              editor.run(() =>
                editor.recordPreview(
                  document.querySelector<HTMLCanvasElement>("#scene")!,
                ),
              )
            }
          >
            {state.recording ? "正在记录…" : "下载 5 秒无声 WebM 预览"}
          </Button>
          <p className="muted">
            带音轨最终成片、AI 拆图、自动编排和模型调用尚未实现。
          </p>
        </div>
      </details>
    </aside>
  );
}
