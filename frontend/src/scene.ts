import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { Editor, EditorState } from "./editor";
import { TEMPLATES, type Project, type SceneObject } from "./schema";
interface RenderObject {
  mesh: THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshStandardMaterial | THREE.MeshBasicMaterial
  >;
  signature: string;
}
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
const rounded = (value: number, min: number, max: number) =>
  Math.round(clamp(value, min, max) * 10000) / 10000;
function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (
      child instanceof THREE.Mesh ||
      child instanceof THREE.LineSegments ||
      child instanceof THREE.Points
    ) {
      child.geometry.dispose();
      for (const material of Array.isArray(child.material)
        ? child.material
        : [child.material]) {
        if ("map" in material)
          (material.map as THREE.Texture | null)?.dispose();
        material.dispose();
      }
    }
  });
}
export class SceneView {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(44, 1, 0.1, 100);
  private renderer: THREE.WebGLRenderer;
  private transform: TransformControls;
  private outline = new THREE.BoxHelper(new THREE.Object3D(), 0xffffff);
  private stage = new THREE.Group();
  private subject?: THREE.Mesh;
  private scan?: THREE.Mesh;
  private rings: THREE.Mesh[] = [];
  private stars: THREE.Points;
  private objects = new Map<string, RenderObject>();
  private pending = new Map<string, { signature: string; token: object }>();
  private pendingLoads: Promise<void> = Promise.resolve();
  private project?: Project;
  private state: EditorState;
  private template = "";
  private disposed = false;
  private frameId = 0;
  private last = 0;
  private resizeObserver: ResizeObserver;
  private pointer?: { x: number; y: number };
  private raycaster = new THREE.Raycaster();
  constructor(
    private canvas: HTMLCanvasElement,
    private editor: Editor,
  ) {
    this.state = editor.state;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.fog = new THREE.FogExp2(0x07101b, 0.035);
    this.scene.add(new THREE.AmbientLight(0xadcaff, 2));
    const key = new THREE.PointLight(0x48dcff, 55, 25);
    key.position.set(2, 3, 4);
    this.scene.add(key);
    const fill = new THREE.PointLight(0xb38aff, 35, 25);
    fill.position.set(-3, 1, 3);
    this.scene.add(fill);
    this.scene.add(this.stage);
    let seed = 0x4e455855;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const positions = Array.from(
      { length: 550 * 3 },
      (_, i) => (random() - 0.5) * (i % 3 === 1 ? 10 : 18),
    );
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    this.stars = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ color: 0x75caff, size: 0.017 }),
    );
    this.scene.add(this.stars);
    this.transform = new TransformControls(this.camera, canvas);
    this.transform.setSize(0.8);
    this.scene.add(this.transform);
    this.outline.visible = false;
    this.scene.add(this.outline);
    this.transform.addEventListener("mouseDown", () => editor.beginTransform());
    this.transform.addEventListener("mouseUp", () => editor.endTransform());
    this.transform.addEventListener("objectChange", () => this.readTransform());
    canvas.addEventListener("pointerdown", this.pointerDown);
    canvas.addEventListener("pointerup", this.pointerUp);
    canvas.addEventListener("webglcontextlost", this.contextLost);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement!);
    this.update(editor.state);
    this.resize();
    this.frameId = requestAnimationFrame(this.frame);
  }
  private contextLost = (event: Event) => {
    event.preventDefault();
    this.editor.failViewport("WebGL 上下文丢失，请保存工程并重新加载");
  };
  private pointerDown = (event: PointerEvent) => {
    this.pointer = { x: event.clientX, y: event.clientY };
  };
  private pointerUp = (event: PointerEvent) => {
    if (
      !this.pointer ||
      this.state.busy ||
      this.state.recording ||
      this.state.dragging ||
      this.transform.axis ||
      Math.hypot(
        event.clientX - this.pointer.x,
        event.clientY - this.pointer.y,
      ) > 4
    )
      return;
    const bounds = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        (-(event.clientY - bounds.top) / bounds.height) * 2 + 1,
      ),
      this.camera,
    );
    const candidates = [...this.objects.values()]
      .map((o) => o.mesh)
      .filter((o) => o.visible);
    const hit = this.raycaster.intersectObjects(candidates, false)[0];
    this.editor.select(hit ? (hit.object.userData.objectId as string) : null);
  };
  private readTransform() {
    const mesh = this.transform.object;
    if (!mesh || !this.state.dragging) return;
    const patch = {
      x: rounded(mesh.position.x, -20, 20),
      y: rounded(mesh.position.y, -20, 20),
      z: rounded(mesh.position.z, -20, 20),
      rx: rounded(mesh.rotation.x, -Math.PI * 20, Math.PI * 20),
      ry: rounded(mesh.rotation.y, -Math.PI * 20, Math.PI * 20),
      rz: rounded(mesh.rotation.z, -Math.PI * 20, Math.PI * 20),
      sx: rounded(mesh.scale.x, 0.05, 10),
      sy: rounded(mesh.scale.y, 0.05, 10),
      sz: rounded(mesh.scale.z, 0.05, 10),
    };
    this.editor.previewTransform(mesh.userData.objectId as string, patch);
  }
  cancelDrag() {
    this.transform.reset();
    this.editor.endTransform(true);
    this.transform.dragging = false;
    this.transform.axis = null;
  }
  private mesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: [number, number, number] = [0, 0, 0],
  ) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    this.stage.add(mesh);
    return mesh;
  }
  private buildStage(project: Project) {
    disposeObject(this.stage);
    this.stage.clear();
    this.rings = [];
    this.scan = undefined;
    const neon = () =>
      new THREE.MeshBasicMaterial({
        color: project.object.color,
        transparent: true,
        opacity: 0.8,
      });
    const metal = () =>
      new THREE.MeshStandardMaterial({
        color: project.object.color,
        metalness: 0.85,
        roughness: 0.22,
        emissive: project.object.color,
        emissiveIntensity: 0.15,
      });
    if (project.template === "energy") {
      this.subject = this.mesh(
        new THREE.IcosahedronGeometry(0.8, 1),
        metal(),
        [0, 0, -0.6],
      );
      for (let i = 0; i < 3; i++) {
        const ring = this.mesh(
          new THREE.TorusGeometry(1.25 + i * 0.2, 0.018, 8, 90),
          neon(),
          [0, 0, -0.6],
        );
        ring.userData.tilt = i;
        this.rings.push(ring);
      }
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        this.mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.65, 6), neon(), [
          Math.cos(angle) * 2.4,
          Math.sin(angle) * 1.65,
          -1.8,
        ]);
      }
    } else if (project.template === "holo") {
      this.subject = this.mesh(
        new THREE.IcosahedronGeometry(0.85, 1),
        new THREE.MeshBasicMaterial({
          color: project.object.color,
          wireframe: true,
        }),
        [0, 0.05, -0.6],
      );
      this.mesh(
        new THREE.CylinderGeometry(1.55, 1.8, 0.18, 60),
        metal(),
        [0, -1.35, -0.6],
      );
      for (let i = 0; i < 4; i++) {
        const ring = this.mesh(
          new THREE.TorusGeometry(1.2 + i * 0.2, 0.012, 6, 80),
          neon(),
          [0, -1.18 + i * 0.12, -0.6],
        );
        ring.rotation.x = Math.PI / 2;
        this.rings.push(ring);
      }
      this.scan = this.mesh(
        new THREE.PlaneGeometry(2.8, 2.8),
        new THREE.MeshBasicMaterial({
          color: project.object.color,
          transparent: true,
          opacity: 0.12,
          side: THREE.DoubleSide,
        }),
        [0, 0, -0.6],
      );
      this.scan.rotation.x = Math.PI / 2;
    } else if (project.template === "luxury") {
      this.subject = this.mesh(
        new THREE.SphereGeometry(0.72, 40, 28),
        metal(),
        [0, 0.05, -0.65],
      );
      this.mesh(
        new THREE.CylinderGeometry(1.2, 1.4, 0.4, 64),
        new THREE.MeshStandardMaterial({
          color: 0x2b2520,
          metalness: 0.95,
          roughness: 0.18,
        }),
        [0, -1.1, -0.65],
      );
      for (let i = 0; i < 3; i++) {
        const x = 1.7 + i * 0.45,
          y = 0.95 + i * 0.2;
        for (const sign of [-1, 1])
          this.mesh(
            new THREE.BoxGeometry(0.035, 3.4 + i * 0.4, 0.035),
            neon(),
            [sign * x, -0.3, -1 - i * 0.8],
          );
        this.mesh(new THREE.BoxGeometry(x * 2, 0.035, 0.035), neon(), [
          0,
          y + 0.45,
          -1 - i * 0.8,
        ]);
      }
    } else {
      this.subject = this.mesh(
        new THREE.BoxGeometry(1.1, 1.1, 1.1),
        new THREE.MeshStandardMaterial({
          color: project.object.color,
          wireframe: true,
        }),
        [0, 0.2, -0.6],
      );
      const grid = new THREE.GridHelper(18, 36, project.object.color, 0x123c34);
      grid.position.y = -1.45;
      this.stage.add(grid);
      for (let i = 0; i < 16; i++) {
        const side = i % 2 ? 1 : -1,
          height = 0.5 + ((i * 7) % 5) * 0.35;
        this.mesh(
          new THREE.BoxGeometry(0.35, height, 0.45),
          new THREE.MeshStandardMaterial({
            color: project.object.color,
            transparent: true,
            opacity: 0.3,
            wireframe: i % 3 === 0,
          }),
          [
            side * (1.7 + (i % 4) * 0.6),
            -1.45 + height / 2,
            -1 - Math.floor(i / 4) * 0.9,
          ],
        );
      }
    }
    this.template = project.template;
  }
  update(state: EditorState) {
    if (this.disposed) return;
    this.state = state;
    if (this.template !== state.project.template)
      this.buildStage(state.project);
    if (this.project?.objects !== state.project.objects)
      this.reconcile(state.project);
    this.project = state.project;
    this.transform.setMode(state.transformMode);
    this.transform.enabled = !state.busy && !state.playing && !state.recording;
    this.draw();
  }
  private signature(object: SceneObject, project: Project) {
    return JSON.stringify([
      object.kind,
      object.geometry,
      object.width,
      object.height,
      object.depth,
      object.assetId,
      object.kind === "image"
        ? project.assets.find((a) => a.id === object.assetId)?.url
        : "",
      object.text,
      object.kind === "text" ? object.color : "",
    ]);
  }
  private reconcile(project: Project) {
    const keep = new Set(project.objects.map((o) => o.id));
    for (const [id, object] of this.objects)
      if (!keep.has(id)) {
        if (this.transform.object === object.mesh) this.transform.detach();
        this.scene.remove(object.mesh);
        disposeObject(object.mesh);
        this.objects.delete(id);
      }
    for (const id of this.pending.keys())
      if (!keep.has(id)) this.pending.delete(id);
    const loads: Promise<void>[] = [];
    for (const record of project.objects) {
      const signature = this.signature(record, project);
      if (
        this.objects.get(record.id)?.signature === signature ||
        this.pending.get(record.id)?.signature === signature
      )
        continue;
      const old = this.objects.get(record.id);
      if (old) {
        if (this.transform.object === old.mesh) this.transform.detach();
        this.scene.remove(old.mesh);
        disposeObject(old.mesh);
        this.objects.delete(record.id);
      }
      const token = {};
      this.pending.set(record.id, { signature, token });
      const load = this.createObject(record, project)
        .then((mesh) => {
          if (this.disposed || this.pending.get(record.id)?.token !== token) {
            disposeObject(mesh);
            return;
          }
          this.pending.delete(record.id);
          mesh.userData.objectId = record.id;
          this.objects.set(record.id, { mesh, signature });
          this.scene.add(mesh);
          this.draw();
        })
        .catch((error) => {
          if (this.pending.get(record.id)?.token === token) {
            this.pending.delete(record.id);
            this.editor.notify(
              "对象素材无法加载：" + record.name + "；" + String(error),
              "err",
            );
          }
          throw error;
        });
      // Observe every rejection immediately, while retaining it for settled()/load error reporting.
      load.catch(() => {});
      loads.push(load);
    }
    if (loads.length)
      this.pendingLoads = Promise.all([
        this.pendingLoads.catch(() => {}),
        ...loads,
      ]).then(() => {});
    this.pendingLoads.catch(() => {});
  }
  async settled() {
    await this.pendingLoads;
  }
  private async createObject(
    record: SceneObject,
    project: Project,
  ): Promise<RenderObject["mesh"]> {
    let geometry: THREE.BufferGeometry;
    if (record.kind === "primitive") {
      geometry =
        record.geometry === "sphere"
          ? new THREE.SphereGeometry(0.5, 32, 24)
          : record.geometry === "torus"
            ? new THREE.TorusGeometry(0.4, 0.12, 16, 64)
            : new THREE.BoxGeometry(1, 1, 1);
      geometry.scale(record.width, record.height, record.depth);
      return new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: record.color,
          metalness: 0.65,
          roughness: 0.28,
          transparent: true,
        }),
      );
    }
    let texture: THREE.Texture;
    if (record.kind === "image") {
      const asset = project.assets.find((a) => a.id === record.assetId)!;
      texture = await new THREE.TextureLoader().loadAsync(asset.url);
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = 1024;
      canvas.height = 256;
      const context = canvas.getContext("2d");
      if (!context) throw Error("无法创建标题画布");
      context.font = "bold 88px Arial";
      context.textAlign = "center";
      context.fillStyle = record.color;
      context.fillText(record.text ?? "", 512, 150, 1000);
      texture = new THREE.CanvasTexture(canvas);
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(
      new THREE.PlaneGeometry(record.width, record.height),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide,
      }),
    );
  }
  private pose() {
    const project = this.state.project,
      time = this.state.elapsed,
      keys = project.keyframes;
    if (!keys.length)
      return {
        scale: project.object.scale,
        color: new THREE.Color(project.object.color),
      };
    let a = keys[0],
      b = keys.at(-1)!;
    if (time <= a.t) return { scale: a.scale, color: new THREE.Color(a.color) };
    if (time >= b.t) return { scale: b.scale, color: new THREE.Color(b.color) };
    for (let i = 0; i < keys.length - 1; i++)
      if (time >= keys[i].t && time <= keys[i + 1].t) {
        a = keys[i];
        b = keys[i + 1];
        break;
      }
    const q = (time - a.t) / (b.t - a.t);
    return {
      scale: a.scale + (b.scale - a.scale) * q,
      color: new THREE.Color(a.color).lerp(new THREE.Color(b.color), q),
    };
  }
  private draw() {
    if (this.disposed) return;
    const { project, elapsed, selectedId } = this.state,
      config = TEMPLATES[project.template],
      pose = this.pose();
    this.scene.background = new THREE.Color(config.fog);
    (this.scene.fog as THREE.FogExp2).color.setHex(config.fog);
    this.camera.position.set(0, 0.5, config.distance);
    this.camera.lookAt(0, 0, 0);
    if (this.subject) {
      this.subject.rotation.set(
        elapsed * 0.22 * project.object.speed,
        elapsed * 0.6 * project.object.speed,
        0,
      );
      this.subject.scale.setScalar(pose.scale);
      const material = this.subject.material as THREE.MeshStandardMaterial;
      material.color.copy(pose.color);
      material.transparent = project.object.opacity < 1;
      material.opacity = project.object.opacity;
    }
    this.rings.forEach((ring, i) => {
      const material = ring.material as THREE.MeshBasicMaterial;
      material.color.copy(pose.color);
      material.opacity = project.object.ring;
      if (project.template === "energy")
        ring.rotation.set(
          0.5 + i * 0.8,
          i * 0.4,
          -elapsed * 0.18 * project.object.speed,
        );
    });
    if (this.scan) this.scan.position.y = Math.sin(elapsed * 1.2) * 1.1;
    this.stars.rotation.y = elapsed * 0.01;
    for (const record of project.objects) {
      const object = this.objects.get(record.id)?.mesh;
      if (!object) continue;
      object.position.set(record.x, record.y, record.z);
      object.rotation.set(record.rx, record.ry, record.rz);
      object.scale.set(record.sx, record.sy, record.sz);
      object.visible = record.visible;
      object.material.opacity = record.opacity;
      if (record.kind === "primitive") object.material.color.set(record.color);
    }
    const selected = selectedId
      ? this.objects.get(selectedId)?.mesh
      : undefined;
    if (
      selected?.visible &&
      !this.state.recording &&
      !this.state.playing &&
      !this.state.busy
    ) {
      if (this.transform.object !== selected) this.transform.attach(selected);
      this.outline.visible = true;
      this.outline.setFromObject(selected);
      this.outline.update();
    } else {
      this.transform.detach();
      this.outline.visible = false;
    }
    this.renderer.render(this.scene, this.camera);
    this.canvas.dataset.objectCount = String(this.objects.size);
    this.canvas.dataset.renderedTemplate = project.template;
    this.canvas.dataset.stageNodes = String(this.stage.children.length);
    this.canvas.dataset.selectedId = selectedId ?? "";
    this.canvas.dataset.renderedTime = String(elapsed);
  }
  private resize() {
    if (this.disposed) return;
    const bounds = this.canvas.parentElement!.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    this.renderer.setSize(bounds.width, bounds.height, false);
    this.camera.aspect = bounds.width / bounds.height;
    this.camera.updateProjectionMatrix();
    this.draw();
  }
  private frame = (time: number) => {
    if (this.disposed) return;
    const dt = Math.min((time - (this.last || time)) / 1000, 0.05);
    this.last = time;
    if (this.state.playing) this.editor.tick(dt);
    else this.draw();
    this.frameId = requestAnimationFrame(this.frame);
  };
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener("pointerdown", this.pointerDown);
    this.canvas.removeEventListener("pointerup", this.pointerUp);
    this.canvas.removeEventListener("webglcontextlost", this.contextLost);
    this.transform.detach();
    this.transform.dispose();
    disposeObject(this.scene);
    this.renderer.dispose();
  }
}
