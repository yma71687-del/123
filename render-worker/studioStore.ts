import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { studioSchema, type StudioProject } from "../video/studio/schema";

export type SavedStudio = {
  id: string;
  revision: number;
  updatedAt: string;
  project: StudioProject;
};
const fail = (status: number, message: string) =>
  Object.assign(new Error(message), { status });
export class StudioStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private root: string) {}
  private serial<T>(fn: () => Promise<T>) {
    const next = this.pending.catch(() => {}).then(fn);
    this.pending = next;
    return next;
  }
  private directory(id: string) {
    if (!/^[a-f0-9]{32}$/.test(id)) throw fail(404, "工程不存在");
    return join(this.root, id);
  }
  async get(id: string, revision?: number): Promise<SavedStudio> {
    const path = join(
      this.directory(id),
      revision === undefined ? "head.json" : `${revision}.json`,
    );
    try {
      const record = JSON.parse(await readFile(path, "utf8"));
      if (
        record.id !== id ||
        typeof record.updatedAt !== "string" ||
        Number.isNaN(Date.parse(record.updatedAt)) ||
        !Number.isInteger(record.revision) ||
        record.revision < 1 ||
        (revision !== undefined && record.revision !== revision)
      )
        throw Error("Invalid revision");
      return { ...record, project: studioSchema.parse(record.project) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw fail(404, "工程或版本不存在");
      throw fail(409, "已有工程无法读取，已保留文件，拒绝覆盖");
    }
  }
  async list() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const records = [];
    for (const id of await readdir(this.root)) {
      if (!/^[a-f0-9]{32}$/.test(id)) continue;
      try {
        const v = await this.get(id);
        records.push({
          id,
          revision: v.revision,
          name: v.project.name,
          updatedAt: v.updatedAt,
        });
      } catch {
        records.push({
          id,
          revision: 0,
          name: "无法读取的工程（原文件已保留）",
          updatedAt: "",
        });
      }
    }
    return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async versions(id: string) {
    const head = await this.get(id);
    return {
      versions: Array.from(
        { length: head.revision },
        (_, i) => head.revision - i,
      ),
    };
  }
  save(input: unknown, id?: string, expectedRevision?: number) {
    return this.serial(async () => {
      const project = studioSchema.parse(input);
      let revision = 1;
      if (id) {
        const old = await this.get(id);
        if (old.revision !== expectedRevision)
          throw fail(409, "工程已有更新，请先导出本机备份，再重新打开云端版本");
        if (old.revision >= 100)
          throw fail(409, "工程已达100个版本，请另存为新工程");
        revision = old.revision + 1;
      } else {
        if ((await this.list()).length >= 30)
          throw fail(429, "首批项目库上限30个，请先备份整理工程");
        id = randomUUID().replaceAll("-", "");
      }
      const dir = this.directory(id);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const record: SavedStudio = {
        id,
        revision,
        updatedAt: new Date().toISOString(),
        project,
      };
      const atomic = async (path: string) => {
        const temp = path + "." + randomUUID() + ".tmp";
        try {
          await writeFile(temp, JSON.stringify(record), { mode: 0o600 });
          await rename(temp, path);
        } finally {
          await rm(temp, { force: true });
        }
      };
      await atomic(join(dir, `${revision}.json`));
      await atomic(join(dir, "head.json"));
      return record;
    });
  }
}
