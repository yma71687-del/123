import { useEffect, useRef, useSyncExternalStore } from "react";
import { Editor } from "./editor";
import { message } from "./io";
import { Library } from "./components/Library";
import { Inspector } from "./components/Inspector";
import { Timeline } from "./components/Timeline";
import { Button } from "./components/controls";
import { OFFLINE_PREVIEW, storageLabel } from "./mode";
const editor = new Editor();
export function App() {
  const state = useSyncExternalStore(editor.subscribe, editor.snapshot);
  const canvas = useRef<HTMLCanvasElement>(null),
    audio = useRef<HTMLAudioElement>(null),
    file = useRef<HTMLInputElement>(null);
  const disabled = state.busy || state.recording || state.dragging;
  useEffect(() => {
    editor.run(() => editor.boot(canvas.current!, audio.current!));
    return () => editor.dispose();
  }, []);
  useEffect(() => {
    document.body.dataset.mode = state.mode;
    document.body.dataset.rendererState = state.rendererState;
    document.body.classList.toggle("beginner", state.mode === "beginner");
  }, [state.mode, state.rendererState]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement)?.closest(
          "input,textarea,select,[contenteditable=true]",
        )
      )
        return;
      if (editor.state.busy || editor.state.recording) return;
      const value = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(value)) {
        event.preventDefault();
        if (value === "y" || event.shiftKey) editor.redo();
        else editor.undo();
      } else if (
        !event.ctrlKey &&
        !event.metaKey &&
        ["w", "e", "r"].includes(value)
      ) {
        event.preventDefault();
        editor.setTransformMode(
          value === "w" ? "translate" : value === "e" ? "rotate" : "scale",
        );
      } else if (value === "delete" || value === "backspace") {
        event.preventDefault();
        editor.deleteSelected();
      } else if (value === "escape") {
        if (editor.state.dragging) editor.cancelTransform();
        else editor.select(null);
      }
    };
    const error = (event: ErrorEvent) =>
      editor.notify("页面错误：" + event.message, "err");
    const rejection = (event: PromiseRejectionEvent) =>
      editor.notify("异步操作失败：" + message(event.reason), "err");
    window.addEventListener("keydown", key);
    window.addEventListener("error", error);
    window.addEventListener("unhandledrejection", rejection);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("error", error);
      window.removeEventListener("unhandledrejection", rejection);
    };
  }, []);
  return (
    <>
      <header>
        <div className="brand">
          <div className="logo">N</div>
          <div>
            <h1>NEXUS FX STUDIO</h1>
            <div className="sub">
              {OFFLINE_PREVIEW
                ? "OFFLINE INTERACTIVE PREVIEW"
                : "CLOUD CREATIVE SUITE"}{" "}
              · BUILD 0.4.0
            </div>
          </div>
        </div>
        <div className="top-actions">
          <Button
            action="toggle-mode"
            id="modeBtn"
            aria-pressed={state.mode === "beginner"}
            onClick={() => editor.setMode()}
          >
            {state.mode === "beginner" ? "切换专业模式" : "切换引导模式"}
          </Button>
          <Button
            action="new-project"
            disabled={disabled}
            onClick={() => editor.run(() => editor.newProject())}
          >
            新建工程
          </Button>
          <Button
            action="export-project"
            disabled={disabled}
            onClick={() => editor.exportJSON()}
          >
            导出工程 JSON
          </Button>
          <Button
            action="load-local"
            disabled={disabled || !state.hasBackup}
            onClick={() => editor.run(() => editor.restoreBackup())}
          >
            恢复浏览器备份
          </Button>
          <Button
            action="pick-project"
            disabled={disabled}
            onClick={() => file.current?.click()}
          >
            导入工程
          </Button>
          <input
            ref={file}
            id="projectFile"
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const item = e.target.files?.[0];
              if (item) editor.run(() => editor.importJSON(item));
              e.target.value = "";
            }}
          />
          <Button
            action="save-project"
            className="primary"
            disabled={disabled}
            onClick={() => editor.run(() => editor.save())}
          >
            保存到{storageLabel}
          </Button>
        </div>
      </header>
      {OFFLINE_PREVIEW && (
        <div className="offline-note" role="note">
          离线试用：工程与素材仅保存在当前浏览器。可体验对象编辑、时间轴、音效和无声预览；云端与
          AI 服务未连接。请使用电脑 Chrome／Edge
          的普通浏览模式，保留此文件与浏览器数据。
        </div>
      )}
      <div
        id="status"
        className={"global-status " + state.statusType}
        role={state.statusType === "err" ? "alert" : "status"}
        aria-live="polite"
      >
        {state.status}
      </div>
      <div className="guidebar">
        <strong>
          选择场景 → 导入／添加对象 → 拖动轴柄或输入参数 → 保存工程
        </strong>
        <span>
          W 移动 · E 旋转 · R 缩放 · Ctrl/⌘ Z 撤销 · Ctrl/⌘ Shift Z 重做
        </span>
      </div>
      <div className="app">
        <Library editor={editor} state={state} />
        <main className="panel composition">
          <div className="timehead">
            <div>
              <h2>实时 3D 合成</h2>
              <span id="projectTitle" className="muted">
                {state.project.name}
              </span>
            </div>
            <span className="tag">
              {state.project.aspect} ·{" "}
              {state.rendererState === "ready" ? "WEBGL" : "等待渲染"}
            </span>
          </div>
          <div className="history-toolbar row wrap">
            <Button
              action="undo"
              disabled={disabled || !state.canUndo}
              title={state.undoLabel ? "撤销：" + state.undoLabel : "暂无历史"}
              onClick={() => editor.undo()}
            >
              ↶ 撤销
            </Button>
            <Button
              action="redo"
              disabled={disabled || !state.canRedo}
              title={state.redoLabel ? "重做：" + state.redoLabel : "暂无历史"}
              onClick={() => editor.redo()}
            >
              ↷ 重做
            </Button>
            <span className="muted">
              {state.selectedId
                ? "对象已选中 · 拖动轴柄编辑"
                : "点击对象或对象树进行选择"}
            </span>
          </div>
          <div
            className="viewport"
            data-aspect={state.project.aspect}
            style={{ aspectRatio: state.project.aspect.replace(":", "/") }}
          >
            <canvas
              ref={canvas}
              id="scene"
              aria-label="3D 场景预览与对象编辑"
              tabIndex={0}
            />
            <div
              id="viewportFallback"
              className="viewport-fallback"
              role="alert"
              hidden={state.rendererState !== "failed"}
            >
              {state.rendererError}。工程导入、保存和 JSON 备份仍可使用；3D
              预览和轴柄操作已停用。
            </div>
            <div className="viewlabel">CAMERA 01 · 固定镜头 · PREVIEW</div>
          </div>
          <div className="viewfoot">
            <div className="row wrap">
              <Button
                action="play"
                id="playBtn"
                className="primary"
                disabled={disabled || state.rendererState !== "ready"}
                onClick={() => editor.play()}
              >
                {state.playing ? "❚❚ 暂停" : "▶ 播放"}
              </Button>
              <Button
                action="reset"
                disabled={disabled || state.rendererState !== "ready"}
                onClick={() => editor.resetTime()}
              >
                重置预览
              </Button>
            </div>
            <span id="timeLabel">
              {state.elapsed.toFixed(1)} s / {state.project.duration.toFixed(1)}{" "}
              s
            </span>
          </div>
          <Timeline editor={editor} state={state} />
          <div className="scope-note">
            已实现：场景、对象编辑、撤销重做、工程保存。AI 拆图、Skills
            自动编排和带音轨成片仍待开发。
          </div>
        </main>
        <Inspector editor={editor} state={state} />
      </div>
      <audio ref={audio} id="audioPlayer" preload="auto" />
    </>
  );
}
