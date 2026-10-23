import { normalizeProject, type Project } from "./schema";
interface Entry {
  project: Project;
  label: string;
}
/** Immutable project snapshots; transient selection/time never enter the command stack. */
export class History {
  private past: Entry[] = [];
  private future: Entry[] = [];
  private gesture?: Project;
  private merge?: { key: string; time: number };
  constructor(
    public current: Project,
    private limit = 80,
  ) {
    this.current = normalizeProject(current);
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  get undoLabel() {
    return this.past.at(-1)?.label ?? "";
  }
  get redoLabel() {
    return this.future.at(-1)?.label ?? "";
  }
  execute(label: string, recipe: (draft: Project) => void, mergeKey?: string) {
    const next = structuredClone(this.current);
    recipe(next);
    const valid = normalizeProject(next);
    if (JSON.stringify(valid) === JSON.stringify(this.current)) return false;
    const now = Date.now();
    if (
      !mergeKey ||
      !this.merge ||
      this.merge.key !== mergeKey ||
      now - this.merge.time > 600
    ) {
      this.past.push({ project: this.current, label });
      if (this.past.length > this.limit) this.past.shift();
    }
    this.current = valid;
    this.future = [];
    this.merge = mergeKey ? { key: mergeKey, time: now } : undefined;
    return true;
  }
  beginGesture() {
    if (!this.gesture) this.gesture = this.current;
    this.merge = undefined;
  }
  preview(recipe: (draft: Project) => void) {
    if (!this.gesture) throw Error("未开始变换操作");
    const next = structuredClone(this.current);
    recipe(next);
    this.current = normalizeProject(next);
  }
  endGesture(cancel = false) {
    if (!this.gesture) return;
    if (cancel) this.current = this.gesture;
    else if (JSON.stringify(this.current) !== JSON.stringify(this.gesture)) {
      this.past.push({ project: this.gesture, label: "拖动对象变换" });
      if (this.past.length > this.limit) this.past.shift();
      this.future = [];
    }
    this.gesture = undefined;
  }
  undo() {
    this.endGesture(true);
    this.merge = undefined;
    const entry = this.past.pop();
    if (!entry) return;
    this.future.push({ project: this.current, label: entry.label });
    this.current = entry.project;
  }
  redo() {
    this.endGesture(true);
    this.merge = undefined;
    const entry = this.future.pop();
    if (!entry) return;
    this.past.push({ project: this.current, label: entry.label });
    this.current = entry.project;
  }
  reset(project: Project) {
    this.current = normalizeProject(project);
    this.past = [];
    this.future = [];
    this.gesture = undefined;
    this.merge = undefined;
  }
}
