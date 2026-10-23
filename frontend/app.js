import {
  emptyProject,
  normalizeProject,
  assetKind,
  TEMPLATES,
  uid,
} from "./project.js";
const $ = (id) => document.getElementById(id);
const audio = $("audioPlayer");
let project = emptyProject(),
  scene,
  camera,
  renderer,
  core,
  ring,
  stars,
  playing = false,
  elapsed = 0,
  last = 0,
  sceneReady = false,
  frameStarted = false,
  renderEpoch = 0,
  recording = false,
  loadingProject = true,
  uploading = false;
const meshes = new Map();
const KEY = "nexus-project-v3";
const notify = (message, type = "") => {
  $("status").textContent = message;
  $("status").className = "status global-status " + type;
  $("status").setAttribute("role", type === "err" ? "alert" : "status");
};
const controls = () => {
  const recorderSupported =
    sceneReady &&
    typeof MediaRecorder !== "undefined" &&
    typeof $("scene").captureStream === "function" &&
    MediaRecorder.isTypeSupported("video/webm");
  for (const el of document.querySelectorAll("button,input,select")) {
    const name = el.dataset.action;
    let disabled = (loadingProject || uploading) && name !== "toggle-mode";
    if (el.dataset.requires === "scene" && !sceneReady) disabled = true;
    if (el.dataset.unavailable) disabled = true;
    if (name === "load-local") {
      try {
        disabled ||= !localStorage.getItem(KEY);
      } catch {
        disabled = true;
      }
    }
    if (name === "preview-audio" && !cue().assetId) disabled = true;
    if (name === "download-preview") {
      disabled ||= recording || !recorderSupported;
      el.title = recorderSupported
        ? "仅录制无声画布；不是带音轨成片"
        : "此浏览器无法录制 WebM 画布预览";
    }
    el.disabled = disabled;
  }
  for (const bar of document.querySelectorAll(".trackbar")) {
    const disabled = !sceneReady || loadingProject || uploading;
    bar.setAttribute("aria-disabled", String(disabled));
    bar.tabIndex = disabled ? -1 : 0;
  }
  $("scene").dataset.objectCount = meshes.size;
};

function failViewport(message) {
  sceneReady = false;
  playing = false;
  audio.pause();
  document.body.dataset.rendererState = "failed";
  $("viewportFallback").hidden = false;
  $("viewportFallback").textContent =
    message +
    "。工程导入、保存和 JSON 备份仍可使用；3D 操作已停用。请检查 WebGL 支持或重新加载页面。";
  controls();
  notify(message, "err");
}
function cue() {
  return project.audioEvents[0] ?? { assetId: null, time: 2.5, volume: 0.3 };
}
async function api(url, options = {}) {
  const response = await fetch(url, options);
  let body;
  try {
    body = await response.json();
  } catch {
    throw Error(`服务器返回无效响应（HTTP ${response.status}）`);
  }
  if (!response.ok)
    throw Error(
      typeof body.detail === "string"
        ? body.detail
        : `HTTP ${response.status}：请求被拒绝`,
    );
  return body;
}
function applyMode(simple, announce = true) {
  document.body.classList.toggle("beginner", simple);
  document.body.dataset.mode = simple ? "beginner" : "professional";
  $("modeBtn").textContent = simple ? "切换专业模式" : "切换新手模式";
  $("modeBtn").setAttribute("aria-pressed", String(simple));
  if (announce) notify(simple ? "已切换新手模式" : "已切换专业模式", "ok");
  resize();
}
function resize() {
  if (!sceneReady) return;
  const bounds = $("scene").parentElement.getBoundingClientRect();
  renderer.setSize(bounds.width, bounds.height, false);
  camera.aspect = bounds.width / bounds.height;
  camera.updateProjectionMatrix();
  renderScene();
}
function initScene() {
  try {
    if (typeof window.THREE === "undefined")
      throw Error("本地 3D 依赖加载失败");
    const T = window.THREE;
    scene = new T.Scene();
    scene.fog = new T.FogExp2(0x07101b, 0.055);
    camera = new T.PerspectiveCamera(44, 1, 0.1, 100);
    renderer = new T.WebGLRenderer({
      canvas: $("scene"),
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    scene.add(new T.AmbientLight(0x9acaff, 1.7));
    const a = new T.PointLight(0x35cfff, 38, 20);
    a.position.set(2, 2, 3);
    scene.add(a);
    const b = new T.PointLight(0x734bff, 12, 16);
    b.position.set(-3, -1, 1);
    scene.add(b);
    core = new T.Mesh(
      new T.IcosahedronGeometry(1, 2),
      new T.MeshStandardMaterial({
        color: 0x48dcff,
        metalness: 0.88,
        roughness: 0.22,
        emissive: 0x073b62,
        emissiveIntensity: 1.2,
      }),
    );
    scene.add(core);
    ring = new T.Mesh(
      new T.TorusGeometry(1.45, 0.025, 14, 160),
      new T.MeshBasicMaterial({
        color: 0x48dcff,
        transparent: true,
        opacity: 0.8,
      }),
    );
    scene.add(ring);
    let seed = 0x4e455855;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const points = [];
    for (let i = 0; i < 700; i++)
      points.push(
        (random() - 0.5) * 17,
        (random() - 0.5) * 10,
        (random() - 0.5) * 12,
      );
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.Float32BufferAttribute(points, 3));
    stars = new T.Points(
      geometry,
      new T.PointsMaterial({ color: 0x75caff, size: 0.018 }),
    );
    scene.add(stars);
    sceneReady = true;
    document.body.dataset.rendererState = "ready";
    $("viewportFallback").hidden = true;
    resize();
    controls();
    if (!frameStarted) {
      frameStarted = true;
      requestAnimationFrame(frame);
    }
  } catch (error) {
    failViewport("3D 预览不可用：" + error.message);
  }
}
function pose() {
  let scale = project.object.scale,
    color = project.object.color;
  const keys = project.keyframes;
  if (keys.length) {
    let a = keys[0],
      b = keys.at(-1);
    if (elapsed <= a.t) {
      scale = a.scale;
      color = a.color;
    } else if (elapsed >= b.t) {
      scale = b.scale;
      color = b.color;
    } else
      for (let i = 0; i < keys.length - 1; i++)
        if (elapsed >= keys[i].t && elapsed <= keys[i + 1].t) {
          a = keys[i];
          b = keys[i + 1];
          const q = (elapsed - a.t) / (b.t - a.t);
          scale = a.scale + (b.scale - a.scale) * q;
          color =
            "#" +
            new THREE.Color(a.color)
              .lerp(new THREE.Color(b.color), q)
              .getHexString();
          break;
        }
  }
  return { scale, color };
}
function renderScene() {
  if (!sceneReady) return;
  const cfg = TEMPLATES[project.template],
    p = pose();
  scene.fog.color.setHex(cfg.fog);
  camera.position.set(0, 0.5, cfg.distance);
  core.rotation.set(
    elapsed * 0.22 * project.object.speed,
    elapsed * 0.6 * project.object.speed,
    0,
  );
  core.scale.setScalar(p.scale);
  core.material.color.set(p.color);
  core.material.opacity = project.object.opacity;
  core.material.transparent = project.object.opacity < 0.999;
  ring.material.color.set(p.color);
  ring.material.opacity = project.object.ring;
  ring.rotation.set(cfg.ring, 0, -elapsed * 0.18 * project.object.speed);
  stars.rotation.y = elapsed * 0.01;
  renderer.render(scene, camera);
  $("scene").dataset.renderedTemplate = project.template;
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - (last || now)) / 1000, 0.05);
  last = now;
  if (playing) {
    elapsed += dt;
    if (elapsed >= project.duration) {
      elapsed = 0;
      audio.pause();
    }
    syncAudio();
  }
  renderScene();
  updateTime();
}
function updateTime() {
  $("scrub").value = elapsed;
  $("scrubOut").textContent = elapsed.toFixed(1) + " s";
  $("timeLabel").textContent =
    `${elapsed.toFixed(1)} s / ${project.duration.toFixed(1)} s`;
  for (const id of ["head1", "head3", "head4"])
    $(id).style.left = (elapsed / project.duration) * 100 + "%";
}
function syncAudio(force = false) {
  const event = cue(),
    relative = elapsed - event.time;
  if (
    !playing ||
    !event.assetId ||
    relative < 0 ||
    relative >= audio.duration
  ) {
    if (!audio.paused) audio.pause();
    $("audioState").textContent = event.assetId
      ? playing
        ? "等待音效触发"
        : "已暂停"
      : "未选择音频";
    return;
  }
  audio.volume = event.volume;
  if (
    Number.isFinite(audio.duration) &&
    (force || Math.abs(audio.currentTime - relative) > 0.2)
  )
    audio.currentTime = Math.max(0, relative);
  if (audio.paused)
    audio
      .play()
      .catch((error) => notify("音频播放失败：" + error.message, "err"));
}
audio.addEventListener("playing", () => {
  $("audioState").textContent = "正在播放主音效";
});
audio.addEventListener("ended", () => {
  $("audioState").textContent = "主音效已结束";
});
audio.addEventListener("error", () => {
  if (cue().assetId) notify("音频加载失败：请检查源素材是否仍存在", "err");
});
function updateAudio() {
  const event = cue(),
    selected = project.assets.find((a) => a.id === event.assetId);
  const source = selected?.url || "";
  if (audio.getAttribute("src") !== source) {
    audio.pause();
    if (source) audio.src = source;
    else audio.removeAttribute("src");
    audio.load();
  }
  $("audioState").textContent = source ? "等待播放 / 试听" : "未选择音频";
  controls();
}
function clearMeshes() {
  renderEpoch++;
  for (const mesh of meshes.values()) {
    scene?.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.map?.dispose();
    mesh.material.dispose();
  }
  meshes.clear();
  controls();
}
function addMesh(record, epoch = renderEpoch) {
  if (!sceneReady) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const install = (texture) => {
      if (epoch !== renderEpoch) {
        texture.dispose();
        resolve();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(record.width, record.height),
        new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          side: THREE.DoubleSide,
        }),
      );
      mesh.position.set(record.x, record.y, record.z);
      mesh.userData.objectId = record.id;
      scene.add(mesh);
      meshes.set(record.id, mesh);
      controls();
      resolve();
    };
    if (record.kind === "image") {
      const asset = project.assets.find((a) => a.id === record.assetId);
      new THREE.TextureLoader().load(asset.url, install, undefined, () =>
        reject(Error("图片素材加载失败：" + asset.name)),
      );
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = 1024;
      canvas.height = 256;
      const ctx = canvas.getContext("2d");
      ctx.font = "bold 88px Arial";
      ctx.textAlign = "center";
      ctx.fillStyle = record.color;
      ctx.fillText(record.text, 512, 145);
      install(new THREE.CanvasTexture(canvas));
    }
  });
}
async function applyProject(input) {
  const normalized = normalizeProject(input);
  playing = false;
  audio.pause();
  project = normalized;
  elapsed = 0;
  clearMeshes();
  syncUI();
  const epoch = renderEpoch;
  const results = await Promise.allSettled(
    project.objects.map((o) => addMesh(o, epoch)),
  );
  const errors = results.filter((r) => r.status === "rejected");
  if (errors.length)
    throw Error(
      "工程参数已恢复，但 " +
        errors.length +
        " 个对象素材无法加载；请保留工程并检查源素材",
    );
  return project;
}
function syncUI() {
  const o = project.object,
    e = cue();
  $("objname").value = project.name;
  $("projectTitle").textContent = project.name;
  $("aspect").value = project.aspect;
  $("aspectOut").textContent = project.aspect;
  document.querySelector(".viewport").dataset.aspect = project.aspect;
  for (const key of ["color", "speed", "scale", "opacity", "ring"])
    $(key).value = o[key];
  $("soundtime").value = e.time;
  $("soundtime").max = project.duration;
  $("volume").value = e.volume;
  $("scrub").max = project.duration;
  document
    .querySelectorAll("[data-template]")
    .forEach((el) =>
      el.classList.toggle("active", el.dataset.template === project.template),
    );
  renderAssets();
  renderKeys();
  updateOutputs();
  updateAudio();
  updateTime();
  resize();
}
function updateOutputs() {
  $("colorOut").textContent = project.object.color.toUpperCase();
  $("speedOut").textContent = project.object.speed.toFixed(1) + "×";
  $("scaleOut").textContent = project.object.scale.toFixed(1);
  $("opacityOut").textContent = Math.round(project.object.opacity * 100) + "%";
  $("ringOut").textContent = Math.round(project.object.ring * 100) + "%";
  $("volumeOut").textContent = Math.round(cue().volume * 100) + "%";
}
function renderKeys() {
  $("keyCount").textContent = project.keyframes.length;
  $("keyList").textContent = project.keyframes.length
    ? "主体颜色 / 尺寸关键帧：" +
      project.keyframes
        .map((k) => `${k.t.toFixed(1)}s / ${k.scale.toFixed(1)}× / ${k.color}`)
        .join(" · ")
    : "尚未创建主体颜色 / 尺寸关键帧。";
}
function renderAssets() {
  $("assets").replaceChildren();
  if (!project.assets.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "尚未导入素材";
    $("assets").append(empty);
  }
  $("audioAsset").replaceChildren(new Option("未选择音频", ""));
  for (const asset of project.assets) {
    const row = document.createElement("div");
    row.className = "asset";
    row.dataset.asset = asset.id;
    const info = document.createElement("div"),
      name = document.createElement("strong"),
      meta = document.createElement("small");
    name.textContent = asset.name;
    meta.textContent = `${Math.round(asset.size / 1024)} KB · ${assetKind(asset)}`;
    info.append(name, meta);
    row.append(info);
    $("assets").append(row);
    if (assetKind(asset) === "audio")
      $("audioAsset").append(new Option(asset.name, asset.id));
  }
  $("audioAsset").value = cue().assetId || "";
  $("imageClip").style.width = project.objects.length ? "100%" : "0%";
  $("imageClip").textContent = project.objects.length + " 个静态对象";
  $("imageClip").classList.add("clip-label");
  $("audioClip").style.left = (cue().time / project.duration) * 100 + "%";
  $("audioClip").style.width = cue().assetId ? "2%" : "0%";
  controls();
}
function snapshot() {
  return { project: normalizeProject(project) };
}
async function saveProject() {
  const data = snapshot();
  try {
    await api("/api/project", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {}
    notify("工程已保存到云端：" + project.name, "ok");
  } catch (error) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      notify("云端保存失败，已暂存浏览器：" + error.message, "err");
    } catch {
      notify(
        "云端及浏览器备份都未保存成功，请立即导出 JSON：" + error.message,
        "err",
      );
    }
  } finally {
    controls();
  }
}
async function loadProject() {
  loadingProject = true;
  controls();
  try {
    const data = await api("/api/project");
    await applyProject(data.project);
    notify("已读取云端工程与素材引用", "ok");
  } catch (error) {
    let raw;
    try {
      raw = localStorage.getItem(KEY);
    } catch {}
    if (raw) {
      await applyProject(JSON.parse(raw).project);
      notify("云端读取失败，已恢复浏览器备份", "err");
    } else notify("工程读取未完成：" + error.message, "err");
  } finally {
    loadingProject = false;
    controls();
  }
}
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportProject() {
  download(
    new Blob([JSON.stringify(snapshot(), null, 2)], {
      type: "application/json",
    }),
    "nexus-fx-project.json",
  );
  notify("工程 JSON 已导出（素材引用，不含媒体文件）", "ok");
}
async function uploadFiles(files) {
  const input = $("assetFile");
  uploading = true;
  controls();
  try {
    for (const file of files) {
      if (project.assets.length >= 100) throw Error("单工程最多 100 份素材");
      if (file.type.startsWith("image/") && project.objects.length >= 100)
        throw Error("单工程最多 100 个图片 / 标题对象");
      let dimensions = { width: 1.5, height: 1.1 };
      if (file.type.startsWith("image/")) {
        let bitmap;
        try {
          bitmap = await createImageBitmap(file);
          const longest = Math.max(bitmap.width, bitmap.height);
          dimensions = {
            width: (1.5 * bitmap.width) / longest,
            height: (1.5 * bitmap.height) / longest,
          };
        } catch {
          throw Error("图片无法解码，请使用有效的 PNG / JPEG / WebP 图片");
        } finally {
          bitmap?.close();
        }
      }
      notify("正在上传：" + file.name);
      const data = new FormData();
      data.append("file", file);
      const meta = await api("/api/assets/upload", {
        method: "POST",
        body: data,
      });
      project.assets.push(meta);
      if (assetKind(meta) === "image") {
        const record = {
          id: uid(),
          kind: "image",
          assetId: meta.id,
          x: -1.5 + (project.objects.length % 3) * 0.35,
          y: -0.15,
          z: 0.25 + project.objects.length * 0.03,
          ...dimensions,
        };
        project.objects.push(record);
        renderAssets();
        await addMesh(record);
      } else if (assetKind(meta) === "audio") {
        project.audioEvents = [{ ...cue(), assetId: meta.id }];
      }
      renderAssets();
      updateAudio();
      notify(
        "素材已保存：" +
          meta.name +
          (assetKind(meta) === "video" ? "（视频逐帧合成未实现，仅登记）" : ""),
        "ok",
      );
    }
  } catch (error) {
    notify(
      "导入未完成：" +
        error.message +
        "。未上传成功的文件不会被当作已保存素材。",
      "err",
    );
  } finally {
    input.value = "";
    uploading = false;
    controls();
  }
}
function chooseTemplate(name) {
  if (!Object.hasOwn(TEMPLATES, name)) throw Error("未知视觉预设");
  project.template = name;
  project.object.color = TEMPLATES[name].color;
  syncUI();
  notify("已应用视觉预设：" + name + "（共享基础几何）", "ok");
}
function togglePlay() {
  playing = !playing;
  last = performance.now();
  $("playBtn").textContent = playing ? "❚❚ 暂停" : "▶ 播放";
  syncAudio(true);
}
function seek(value) {
  elapsed = Math.min(project.duration, Math.max(0, Number(value) || 0));
  syncAudio(true);
  renderScene();
  updateTime();
}
function audioParams() {
  const time = Number($("soundtime").value),
    volume = Number($("volume").value);
  if (!Number.isFinite(time) || time < 0 || time > project.duration) {
    $("soundtime").value = cue().time;
    throw Error("音效时间超出工程范围");
  }
  project.audioEvents = [
    { assetId: $("audioAsset").value || null, time, volume },
  ];
  updateOutputs();
  updateAudio();
  renderAssets();
}
async function previewAudio() {
  if (!cue().assetId) throw Error("请先选择音频素材");
  playing = false;
  $("playBtn").textContent = "▶ 播放";
  audio.currentTime = 0;
  audio.volume = cue().volume;
  await audio.play();
  notify("正在试听所选音频", "ok");
}
function addText() {
  if (project.objects.length >= 100)
    throw Error("单工程最多 100 个图片 / 标题对象");
  const record = {
    id: uid(),
    kind: "text",
    text: project.name,
    color: project.object.color,
    x: 0,
    y: -1.35,
    z: 0.2,
    width: 2.5,
    height: 0.62,
  };
  project.objects.push(record);
  renderAssets();
  return addMesh(record).then(() => notify("已加入可恢复的标题平面", "ok"));
}
function newProject() {
  if (
    !confirm(
      "新建工程将清空当前场景、素材引用和关键帧。请先保存或导出，是否继续？",
    )
  )
    return;
  return applyProject(emptyProject()).then(() =>
    notify("已创建空白工程；云端旧工程尚未被覆盖", "ok"),
  );
}
async function recordPreview() {
  if (recording) return;
  let stream, rec, timer;
  try {
    recording = true;
    controls();
    const wasPlaying = playing,
      oldTime = elapsed;
    stream = $("scene").captureStream(30);
    rec = new MediaRecorder(stream, { mimeType: "video/webm" });
    const chunks = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      clearTimeout(timer);
      stream.getTracks().forEach((t) => t.stop());
      audio.pause();
      playing = wasPlaying;
      elapsed = oldTime;
      recording = false;
      syncAudio(true);
      controls();
      $("playBtn").textContent = playing ? "❚❚ 暂停" : "▶ 播放";
      download(
        new Blob(chunks, { type: "video/webm" }),
        "nexus-silent-preview.webm",
      );
      notify("已下载 5 秒无声画布预览；不是带音轨最终视频", "ok");
    };
    elapsed = 0;
    playing = true;
    last = performance.now();
    audio.pause();
    rec.start();
    $("playBtn").textContent = "❚❚ 暂停";
    timer = setTimeout(() => rec.stop(), 5000);
    notify("正在记录 5 秒无声画布预览…");
  } catch (error) {
    stream?.getTracks().forEach((t) => t.stop());
    recording = false;
    controls();
    notify("画布预览导出失败：" + error.message, "err");
  }
}
const actions = {
  "toggle-mode": () => applyMode(!document.body.classList.contains("beginner")),
  "new-project": newProject,
  "export-project": exportProject,
  "pick-project": () => $("projectFile").click(),
  "save-project": saveProject,
  "load-project": loadProject,
  "load-local": async () => {
    loadingProject = true;
    controls();
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) throw Error("没有浏览器备份");
      await applyProject(JSON.parse(raw).project);
      notify("已恢复浏览器备份，尚未同步到云端", "ok");
    } finally {
      loadingProject = false;
      controls();
    }
  },
  "pick-assets": () => $("assetFile").click(),
  "guide-scene": () => chooseTemplate("energy"),
  "guide-play": () => {
    if (!playing) togglePlay();
  },
  template: (el) => chooseTemplate(el.dataset.template),
  style: (el) => {
    project.object.color = el.dataset.color;
    syncUI();
  },
  "set-aspect": (el) => {
    project.aspect = el.value;
    syncUI();
    notify("已设置实际预览画幅：" + project.aspect, "ok");
  },
  play: togglePlay,
  reset: () => {
    playing = false;
    $("playBtn").textContent = "▶ 播放";
    seek(0);
    notify("预览已暂停并重置到 0 秒");
  },
  "add-key": () => {
    project.keyframes = project.keyframes.filter(
      (k) => Math.abs(k.t - elapsed) > 0.05,
    );
    project.keyframes.push({
      t: Math.round(elapsed * 1000) / 1000,
      scale: project.object.scale,
      color: project.object.color,
    });
    project.keyframes.sort((a, b) => a.t - b.t);
    renderKeys();
    notify("已添加主体颜色 / 尺寸关键帧", "ok");
  },
  "remove-key": () => {
    project.keyframes.pop();
    renderKeys();
    notify("已删除末尾关键帧");
  },
  seek: (el) => seek(el.value),
  title: (el) => {
    project.name = el.value;
    $("projectTitle").textContent = el.value;
  },
  params: () => {
    for (const key of ["color", "speed", "scale", "opacity", "ring"])
      project.object[key] =
        key === "color" ? $(key).value : Number($(key).value);
    if (project.audioEvents.length)
      project.audioEvents[0].volume = Number($("volume").value);
    else
      project.audioEvents = [{ ...cue(), volume: Number($("volume").value) }];
    updateOutputs();
  },
  "audio-params": audioParams,
  "audio-asset": audioParams,
  "preview-audio": previewAudio,
  "add-text": addText,
  "download-preview": recordPreview,
  beep: () => {
    const ctx = new AudioContext(),
      o = ctx.createOscillator(),
      g = ctx.createGain();
    g.gain.value = Number($("volume").value);
    o.frequency.value = 660;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.18);
    o.onended = () => ctx.close();
  },
};
const sceneActions = new Set([
  "template",
  "style",
  "guide-scene",
  "guide-play",
  "play",
  "reset",
  "add-key",
  "remove-key",
  "add-text",
  "seek",
]);
for (const el of document.querySelectorAll("[data-action]")) {
  const name = el.dataset.action,
    handler = actions[name];
  if (!handler) {
    el.disabled = true;
    el.dataset.unavailable = "true";
    notify("未实现的操作已停用：" + name, "err");
    continue;
  }
  if (sceneActions.has(name)) el.dataset.requires = "scene";
  el.addEventListener(el.dataset.event || "click", () => {
    Promise.resolve()
      .then(() => handler(el))
      .catch((error) => notify("操作失败：" + error.message, "err"));
  });
}
$("assetFile").addEventListener("change", (e) =>
  uploadFiles([...e.target.files]),
);
$("projectFile").addEventListener("change", async (e) => {
  loadingProject = true;
  controls();
  try {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) throw Error("工程 JSON 超过 2 MB");
    const data = JSON.parse(await file.text());
    await applyProject(data.project || data);
    notify("工程 JSON 及对象已恢复", "ok");
  } catch (error) {
    notify("工程导入未完成：" + error.message, "err");
  } finally {
    e.target.value = "";
    loadingProject = false;
    controls();
  }
});
for (const bar of document.querySelectorAll(".trackbar")) {
  bar.setAttribute("role", "slider");
  bar.tabIndex = 0;
  bar.setAttribute("aria-label", "时间轴定位");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "15");
  const scrub = (event) => {
    const rect = bar.getBoundingClientRect();
    seek(((event.clientX - rect.left) / rect.width) * project.duration);
  };
  bar.addEventListener("pointerdown", (event) => {
    if (!sceneReady || loadingProject || uploading) return;
    bar.setPointerCapture(event.pointerId);
    scrub(event);
  });
  bar.addEventListener("pointermove", (event) => {
    if (bar.hasPointerCapture(event.pointerId)) scrub(event);
  });
  bar.addEventListener("keydown", (event) => {
    if (!sceneReady || loadingProject || uploading) return;
    if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      seek(elapsed + (event.key === "ArrowLeft" ? -0.1 : 0.1));
    }
  });
}
$("scene").addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  failViewport("WebGL 上下文丢失");
});
window.addEventListener("error", (event) =>
  notify("页面错误：" + event.message, "err"),
);
window.addEventListener("unhandledrejection", (event) =>
  notify(
    "异步操作失败：" + String(event.reason?.message || event.reason),
    "err",
  ),
);
new ResizeObserver(resize).observe(document.querySelector(".viewport"));
applyMode(true, false);
initScene();
loadProject();
