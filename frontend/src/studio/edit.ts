import { studioSchema, type StudioProject } from "../../../video/studio/schema";

export class StudioHistory {
  private past: StudioProject[] = [];
  private future: StudioProject[] = [];
  private merge: { key: string; time: number } | null = null;
  constructor(public current: StudioProject) {}
  get canUndo() {
    return Boolean(this.past.length);
  }
  get canRedo() {
    return Boolean(this.future.length);
  }
  commit(change: (p: StudioProject) => void, mergeKey?: string) {
    const draft = structuredClone(this.current);
    change(draft);
    const next = studioSchema.parse(draft);
    if (JSON.stringify(next) === JSON.stringify(this.current)) return;
    if (
      !mergeKey ||
      this.merge?.key !== mergeKey ||
      Date.now() - this.merge.time > 600
    ) {
      this.past.push(this.current);
      this.past = this.past.slice(-60);
    }
    this.merge = mergeKey ? { key: mergeKey, time: Date.now() } : null;
    this.future = [];
    this.current = next;
  }
  reset(p: StudioProject) {
    this.current = studioSchema.parse(p);
    this.past = [];
    this.future = [];
    this.merge = null;
  }
  undo() {
    const p = this.past.pop();
    if (p) {
      this.future.push(this.current);
      this.current = p;
    }
    this.merge = null;
  }
  redo() {
    const p = this.future.pop();
    if (p) {
      this.past.push(this.current);
      this.current = p;
    }
    this.merge = null;
  }
}
export function splitShot(
  p: StudioProject,
  id: string,
  frame: number,
  newId: string,
) {
  const index = p.shots.findIndex((s) => s.id === id),
    shot = p.shots[index];
  if (
    !shot ||
    frame <= shot.startFrame ||
    frame >= shot.startFrame + shot.durationFrames
  )
    throw Error("播放头需位于镜头内部才能分割");
  const offset = frame - shot.startFrame;
  const right = {
    ...structuredClone(shot),
    id: newId,
    startFrame: frame,
    sourceInFrame: shot.sourceInFrame + offset,
    durationFrames: shot.durationFrames - offset,
  };
  shot.durationFrames = offset;
  p.shots.splice(index + 1, 0, right);
}
