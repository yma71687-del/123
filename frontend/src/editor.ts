import { History } from "./history";
import {
  api,
  assetURL,
  BACKUP_KEY,
  download,
  message,
  prepareAssets,
} from "./io";
import { storageLabel } from "./mode";
import {
  assetKind,
  emptyProject,
  normalizeProject,
  objectDefaults,
  TEMPLATES,
  uid,
  type Asset,
  type AudioEvent,
  type Effect,
  type Project,
  type SceneObject,
  type Template,
} from "./schema";
import type { SceneView } from "./scene";
export type TransformMode = "translate" | "rotate" | "scale";
export interface EditorState {
  project: Project;
  selectedId: string | null;
  mode: "beginner" | "professional";
  transformMode: TransformMode;
  playing: boolean;
  elapsed: number;
  busy: boolean;
  recording: boolean;
  dragging: boolean;
  rendererState: "loading" | "ready" | "failed";
  rendererError: string;
  status: string;
  statusType: "" | "ok" | "err";
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string;
  redoLabel: string;
  hasBackup: boolean;
  audioState: string;
}
export class Editor {
  history = new History(emptyProject());
  private listeners = new Set<() => void>();
  private scene?: SceneView;
  private audio?: HTMLAudioElement;
  private disposed = false;
  private generation = 0;
  private audioBlocked = false;
  private bootedOnce = false;
  state: EditorState = {
    project: this.history.current,
    selectedId: null,
    mode: "beginner",
    transformMode: "translate",
    playing: false,
    elapsed: 0,
    busy: true,
    recording: false,
    dragging: false,
    rendererState: "loading",
    rendererError: "",
    status: `正在连接${storageLabel}工程服务…`,
    statusType: "",
    canUndo: false,
    canRedo: false,
    undoLabel: "",
    redoLabel: "",
    hasBackup: false,
    audioState: "未选择音频",
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  private backupAvailable() {
    try {
      return !!localStorage.getItem(BACKUP_KEY);
    } catch {
      return false;
    }
  }
  private publish(patch: Partial<EditorState> = {}) {
    if (this.disposed) return;
    const project = this.history.current;
    const selectedId = project.objects.some(
      (o) => o.id === this.state.selectedId,
    )
      ? this.state.selectedId
      : null;
    this.state = {
      ...this.state,
      project,
      selectedId,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      undoLabel: this.history.undoLabel,
      redoLabel: this.history.redoLabel,
      ...patch,
    };
    this.scene?.update(this.state);
    for (const listener of this.listeners) listener();
  }
  notify = (status: string, statusType: EditorState["statusType"] = "") =>
    this.publish({ status, statusType });
  run = (action: () => void | Promise<void>) => {
    try {
      Promise.resolve(action()).catch((error) =>
        this.notify("操作失败：" + message(error), "err"),
      );
    } catch (error) {
      this.notify("操作失败：" + message(error), "err");
    }
  };
  async boot(canvas: HTMLCanvasElement, audio: HTMLAudioElement) {
    this.disposed = false;
    this.audio = audio;
    this.publish({ hasBackup: this.backupAvailable() });
    const generation = ++this.generation;
    audio.onplaying = () => this.publish({ audioState: "正在播放主音效" });
    audio.onended = () => this.publish({ audioState: "主音效已结束" });
    audio.onerror = () => {
      if (this.cue.assetId)
        this.notify("音频加载失败：请检查源素材是否仍存在", "err");
    };
    try {
      const { SceneView } = await import("./scene");
      if (generation !== this.generation) return;
      this.scene = new SceneView(canvas, this);
      this.publish({ rendererState: "ready" });
    } catch (error) {
      this.failViewport(
        "本地 3D 依赖加载失败或 WebGL 不可用：" + message(error),
      );
    }
    if (generation !== this.generation) return;
    if (!this.bootedOnce) {
      await this.load();
      this.bootedOnce = true;
    } else {
      this.syncAudio(true);
      await this.scene?.settled();
      this.publish({ busy: false, playing: false });
      this.notify("已恢复当前 3D 工作区；未保存的修改仍保留", "ok");
    }
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    this.scene?.dispose();
    this.scene = undefined;
    this.audio?.pause();
  }
  failViewport(reason: string) {
    this.scene?.dispose();
    this.scene = undefined;
    this.audio?.pause();
    this.publish({
      rendererState: "failed",
      rendererError: reason,
      playing: false,
      status: reason,
      statusType: "err",
    });
  }
  get cue(): AudioEvent {
    return (
      this.state.project.audioEvents[0] ?? {
        assetId: null,
        time: 2.5,
        volume: 0.3,
      }
    );
  }
  private syncAudio(force = false) {
    const audio = this.audio;
    if (!audio) return;
    const event = this.cue,
      asset = this.state.project.assets.find((a) => a.id === event.assetId),
      source = asset ? assetURL(asset) : "";
    if ((audio.getAttribute("src") ?? "") !== source) {
      audio.pause();
      if (source) audio.src = source;
      else audio.removeAttribute("src");
      audio.load();
      this.audioBlocked = false;
    }
    audio.volume = event.volume;
    const relative = this.state.elapsed - event.time;
    if (
      !this.state.playing ||
      !source ||
      relative < 0 ||
      relative >= audio.duration ||
      this.state.recording
    ) {
      audio.pause();
      const audioState = !source
        ? "未选择音频"
        : !this.state.playing
          ? "已暂停"
          : relative < 0
            ? "等待音效触发"
            : "主音效已结束";
      if (this.state.audioState !== audioState) this.publish({ audioState });
      return;
    }
    if (
      Number.isFinite(audio.duration) &&
      (force || Math.abs(audio.currentTime - relative) > 0.2)
    )
      audio.currentTime = Math.max(0, relative);
    if (audio.paused && !this.audioBlocked) {
      this.audioBlocked = true;
      audio
        .play()
        .then(() => {
          this.audioBlocked = false;
        })
        .catch((error) =>
          this.notify("音频播放失败：" + message(error), "err"),
        );
    }
  }
  tick(dt: number) {
    if (!this.state.playing) return;
    const next = this.state.elapsed + dt;
    this.publish({ elapsed: next >= this.state.project.duration ? 0 : next });
    this.syncAudio();
  }
  setMode() {
    this.publish({
      mode: this.state.mode === "beginner" ? "professional" : "beginner",
    });
  }
  select(id: string | null) {
    if (this.state.busy || this.state.recording || this.state.dragging) return;
    this.audio?.pause();
    this.publish({ selectedId: id, playing: false });
  }
  setTransformMode(transformMode: TransformMode) {
    if (!this.state.busy && !this.state.recording)
      this.publish({ transformMode });
  }
  private command(
    label: string,
    recipe: (draft: Project) => void,
    mergeKey?: string,
  ) {
    if (this.state.busy || this.state.recording || this.state.dragging) return;
    if (this.history.execute(label, recipe, mergeKey)) {
      this.publish();
      this.syncAudio();
    }
  }
  setTitle(name: string) {
    this.command(
      "修改工程名",
      (p) => {
        p.name = name;
      },
      "project-name",
    );
  }
  setAspect(aspect: Project["aspect"]) {
    this.command("修改画幅", (p) => {
      p.aspect = aspect;
    });
  }
  setEffect<K extends keyof Effect>(key: K, value: Effect[K]) {
    this.command(
      "修改场景参数",
      (p) => {
        p.object[key] = value;
      },
      "effect-" + key,
    );
  }
  chooseTemplate(template: Template) {
    this.command("切换场景", (p) => {
      p.template = template;
      p.object.color = TEMPLATES[template].color;
    });
    this.notify("已切换参数化场景：" + TEMPLATES[template].name, "ok");
  }
  addPrimitive(geometry: NonNullable<SceneObject["geometry"]>) {
    const name = { box: "立方体", sphere: "球体", torus: "圆环" }[geometry];
    const object = objectDefaults("primitive", {
      geometry,
      name,
      color: this.state.project.object.color,
    });
    this.addObject(object);
  }
  addText() {
    this.addObject(
      objectDefaults("text", {
        text: this.state.project.name,
        name: "品牌标题",
        color: this.state.project.object.color,
        y: -1.35,
        z: 0.8,
        width: 2.5,
        height: 0.62,
      }),
    );
  }
  private addObject(object: SceneObject) {
    if (this.state.project.objects.length >= 100)
      throw Error("单工程最多 100 个对象");
    this.command("添加" + object.name, (p) => {
      p.objects.push(object);
    });
    this.select(object.id);
    this.notify("已添加可编辑对象：" + object.name, "ok");
  }
  editObject(id: string, patch: Partial<SceneObject>, mergeKey?: string) {
    this.command(
      "编辑对象",
      (p) => {
        const object = p.objects.find((o) => o.id === id);
        if (object) Object.assign(object, patch);
      },
      mergeKey ? id + ":" + mergeKey : undefined,
    );
  }
  duplicateSelected() {
    const original = this.state.project.objects.find(
      (o) => o.id === this.state.selectedId,
    );
    if (!original) return;
    this.addObject({
      ...original,
      id: uid(),
      name: (original.name + " 副本").slice(0, 160),
      x: Math.min(20, original.x + 0.35),
      y: Math.min(20, original.y + 0.2),
    });
  }
  deleteSelected() {
    const id = this.state.selectedId;
    this.command("删除对象", (p) => {
      p.objects = p.objects.filter((o) => o.id !== id);
    });
  }
  beginTransform() {
    if (this.state.busy || this.state.recording) return;
    this.history.beginGesture();
    this.audio?.pause();
    this.publish({ dragging: true, playing: false });
  }
  previewTransform(id: string, patch: Partial<SceneObject>) {
    if (!this.state.dragging) return;
    this.history.preview((p) => {
      const object = p.objects.find((o) => o.id === id);
      if (object) Object.assign(object, patch);
    });
    this.publish();
  }
  endTransform(cancel = false) {
    this.history.endGesture(cancel);
    this.publish({ dragging: false });
  }
  cancelTransform() {
    this.scene?.cancelDrag();
  }
  undo() {
    if (this.state.busy || this.state.recording || this.state.dragging) return;
    this.history.undo();
    this.publish();
    this.syncAudio(true);
  }
  redo() {
    if (this.state.busy || this.state.recording || this.state.dragging) return;
    this.history.redo();
    this.publish();
    this.syncAudio(true);
  }
  play() {
    this.publish({ playing: !this.state.playing });
    this.audioBlocked = false;
    this.syncAudio(true);
  }
  seek(time: number) {
    this.publish({
      elapsed: Math.max(0, Math.min(this.state.project.duration, time)),
    });
    this.syncAudio(true);
  }
  resetTime() {
    this.publish({ playing: false, elapsed: 0 });
    this.syncAudio(true);
  }
  addKey() {
    const t = Math.round(this.state.elapsed * 1000) / 1000;
    this.command("添加主体关键帧", (p) => {
      p.keyframes = p.keyframes.filter((k) => Math.abs(k.t - t) > 0.05);
      p.keyframes.push({ t, scale: p.object.scale, color: p.object.color });
    });
  }
  removeKey() {
    this.command("删除末尾关键帧", (p) => {
      p.keyframes.pop();
    });
  }
  setCue(patch: Partial<AudioEvent>, mergeKey?: string) {
    this.command(
      "编辑主音效",
      (p) => {
        p.audioEvents = [{ ...this.cue, ...patch }];
      },
      mergeKey,
    );
  }
  async previewAudio() {
    if (!this.cue.assetId || !this.audio) return;
    this.publish({ playing: false });
    this.audio.currentTime = 0;
    this.audio.volume = this.cue.volume;
    await this.audio.play();
    this.notify("正在试听所选音频", "ok");
  }
  async applyProject(input: unknown) {
    const project = normalizeProject(input); // Validate before touching the current document.
    await prepareAssets(project.assets);
    this.audio?.pause();
    this.history.reset(project);
    this.publish({ selectedId: null, elapsed: 0, playing: false });
    this.syncAudio(true);
    await this.scene?.settled();
  }
  async load() {
    this.publish({ busy: true });
    try {
      const data = await api<{ project: unknown }>("/api/project");
      await this.applyProject(data.project);
      this.notify(`已读取${storageLabel}工程与素材引用`, "ok");
    } catch (error) {
      let raw: string | null = null;
      try {
        raw = localStorage.getItem(BACKUP_KEY);
      } catch {
        /* Visible cloud error below. */
      }
      if (raw) {
        try {
          await this.applyProject(JSON.parse(raw).project);
          this.notify(`${storageLabel}读取失败，已恢复浏览器备份`, "err");
        } catch (backupError) {
          this.notify(
            `${storageLabel}读取失败，浏览器备份也无法读取：` +
              message(backupError) +
              "；请保留原备份",
            "err",
          );
        }
      } else this.notify("工程读取未完成：" + message(error), "err");
    } finally {
      this.publish({ busy: false });
    }
  }
  async save() {
    const snapshot = { project: normalizeProject(this.state.project) };
    this.publish({ busy: true });
    try {
      await api("/api/project", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      });
      try {
        localStorage.setItem(BACKUP_KEY, JSON.stringify(snapshot));
      } catch {
        /* Cloud save succeeded independently. */
      }
      this.notify(
        `工程已保存到${storageLabel}：` + snapshot.project.name,
        "ok",
      );
    } catch (error) {
      try {
        localStorage.setItem(BACKUP_KEY, JSON.stringify(snapshot));
        this.notify(
          `${storageLabel}保存失败，已暂存浏览器：` + message(error),
          "err",
        );
      } catch {
        this.notify(
          `${storageLabel}及浏览器备份都未保存成功，请立即导出 JSON：` +
            message(error),
          "err",
        );
      }
    } finally {
      this.publish({ busy: false, hasBackup: this.backupAvailable() });
    }
  }
  async newProject() {
    if (
      confirm(
        "新建工程将清空当前场景、素材引用和历史。请先保存或导出，是否继续？",
      )
    ) {
      await this.applyProject(emptyProject());
      this.notify(`已创建空白工程；${storageLabel}旧工程尚未被覆盖`, "ok");
    }
  }
  async restoreBackup() {
    this.publish({ busy: true });
    try {
      const raw = localStorage.getItem(BACKUP_KEY);
      if (!raw) throw Error("没有浏览器备份");
      await this.applyProject(JSON.parse(raw).project);
      this.notify(`已恢复浏览器备份，尚未同步到${storageLabel}工程库`, "ok");
    } finally {
      this.publish({ busy: false });
    }
  }
  exportJSON() {
    download(
      new Blob(
        [
          JSON.stringify(
            { project: normalizeProject(this.state.project) },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
      "nexus-fx-project.json",
    );
    this.notify("工程 JSON 已导出（素材引用，不含媒体文件）", "ok");
  }
  async importJSON(file: File) {
    this.publish({ busy: true });
    try {
      if (file.size > 2 * 1024 * 1024) throw Error("工程 JSON 超过 2 MB");
      const data = JSON.parse(await file.text());
      await this.applyProject(data.project ?? data);
      this.notify("工程 JSON 及对象已恢复", "ok");
    } finally {
      this.publish({ busy: false });
    }
  }
  async upload(files: File[]) {
    this.publish({ busy: true });
    try {
      for (const file of files) {
        if (
          this.state.project.assets.length >= 100 ||
          this.state.project.objects.length >= 100
        )
          throw Error("单工程最多 100 份素材／100 个对象");
        let width = 1.5,
          height = 1.1;
        if (file.type.startsWith("image/")) {
          let bitmap: ImageBitmap | undefined;
          try {
            bitmap = await createImageBitmap(file);
            const longest = Math.max(bitmap.width, bitmap.height);
            width = (1.5 * bitmap.width) / longest;
            height = (1.5 * bitmap.height) / longest;
          } catch {
            throw Error("图片无法解码，请使用有效的 PNG / JPEG / WebP 图片");
          } finally {
            bitmap?.close();
          }
        }
        this.notify("正在上传：" + file.name);
        const form = new FormData();
        form.append("file", file);
        const asset = await api<Asset>("/api/assets/upload", {
          method: "POST",
          body: form,
        });
        let selectedId = this.state.selectedId;
        this.history.execute("导入素材", (p) => {
          p.assets.push(asset);
          if (assetKind(asset) === "image") {
            const object = objectDefaults("image", {
              name: asset.name.slice(0, 160),
              assetId: asset.id,
              x: -1.5 + (p.objects.length % 3) * 0.35,
              y: -0.15,
              z: 0.7,
              width,
              height,
              color: "#ffffff",
            });
            p.objects.push(object);
            selectedId = object.id;
          } else if (assetKind(asset) === "audio")
            p.audioEvents = [{ ...this.cue, assetId: asset.id }];
        });
        this.publish({ selectedId });
        this.syncAudio();
        await this.scene?.settled();
        this.notify(
          "素材已保存：" +
            asset.name +
            (assetKind(asset) === "video"
              ? "（视频逐帧合成未实现，仅登记）"
              : ""),
          "ok",
        );
      }
    } catch (error) {
      this.notify(
        "导入未完成：" +
          message(error) +
          "。未上传成功的文件不会被当作已保存素材。",
        "err",
      );
    } finally {
      this.publish({ busy: false });
    }
  }
  get recorderSupported() {
    return (
      this.state.rendererState === "ready" &&
      typeof MediaRecorder !== "undefined" &&
      typeof HTMLCanvasElement.prototype.captureStream === "function" &&
      MediaRecorder.isTypeSupported("video/webm")
    );
  }
  async recordPreview(canvas: HTMLCanvasElement) {
    if (!this.recorderSupported || this.state.recording) return;
    const previous = {
      playing: this.state.playing,
      elapsed: this.state.elapsed,
    };
    let stream: MediaStream | undefined;
    try {
      this.audio?.pause();
      this.publish({ recording: true, playing: true, elapsed: 0 });
      stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => recorder.stop(), 5000);
        recorder.onstop = () => {
          clearTimeout(timer);
          resolve();
        };
        recorder.onerror = () => {
          clearTimeout(timer);
          reject(Error("浏览器录制失败"));
        };
        recorder.start();
        this.notify("正在记录 5 秒无声画布预览…");
      });
      download(
        new Blob(chunks, { type: "video/webm" }),
        "nexus-silent-preview.webm",
      );
      this.notify("已下载 5 秒无声画布预览；不是带音轨最终视频", "ok");
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
      this.publish({ ...previous, recording: false });
      this.syncAudio(true);
    }
  }
}
