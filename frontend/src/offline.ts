import {
  emptyProject,
  normalizeProject,
  uid,
  type Asset,
  type Project,
} from "./schema";

interface StoredAsset {
  metadata: Asset;
  blob: Blob;
}
const urls = new Map<string, string>();
let opening: Promise<IDBDatabase> | undefined;
function database() {
  if (!opening)
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("nexus-fx-offline-preview-v1", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("project");
        request.result.createObjectStore("assets");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(Error("无法打开本机数据库：请使用普通浏览模式，允许本地存储"));
      request.onblocked = () =>
        reject(Error("本机数据库被其他试用窗口占用，请关闭旧窗口再打开"));
    });
  return opening;
}
async function read<T>(store: string, key: string): Promise<T | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, "readonly");
    const request = transaction.objectStore(store).get(key);
    transaction.oncomplete = () => resolve(request.result as T | undefined);
    transaction.onabort = transaction.onerror = () =>
      reject(Error("本机数据读取失败"));
  });
}
async function write(store: string, key: string, value: unknown) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(store, "readwrite");
    transaction.objectStore(store).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(Error("本机保存失败：可能是浏览器存储空间不足，请导出工程备份"));
  });
}
function remember(assetId: string, blob: Blob) {
  const previous = urls.get(assetId);
  if (previous) URL.revokeObjectURL(previous);
  urls.set(assetId, URL.createObjectURL(blob));
}
export function offlineAssetURL(assetId: string) {
  const url = urls.get(assetId);
  if (!url)
    throw Error(
      "本机没有该素材，请重新导入原文件；离线工程不会自动同步云端素材",
    );
  return url;
}
export async function prepareOfflineAssets(assets: Asset[]) {
  for (const asset of assets) {
    if (urls.has(asset.id)) continue;
    const stored = await read<StoredAsset>("assets", asset.id);
    if (!stored)
      throw Error(
        "本机没有素材“" +
          asset.name +
          "”；请先重新导入原文件，JSON 不包含素材文件",
      );
    remember(asset.id, stored.blob);
  }
}
/** Only the explicit standalone build uses IndexedDB. Normal cloud builds use HTTP. */
export async function offlineAPI(
  url: string,
  options: RequestInit = {},
): Promise<unknown> {
  const method = options.method ?? "GET";
  if (url === "/api/project" && method === "GET") {
    const saved = await read<{ project: Project }>("project", "current");
    const project = normalizeProject(saved?.project ?? emptyProject());
    return { project };
  }
  if (url === "/api/project" && method === "PUT") {
    const body = JSON.parse(String(options.body));
    const project = normalizeProject(body.project);
    await write("project", "current", { project });
    return { ok: true, saved: true };
  }
  if (url === "/api/assets/upload" && method === "POST") {
    if (!(options.body instanceof FormData)) throw Error("请选择素材文件");
    const file = options.body.get("file");
    if (!(file instanceof File) || !file.size) throw Error("素材文件为空");
    if (!/^(image|audio|video)\//.test(file.type))
      throw Error("仅支持图片、音频或视频素材");
    if (file.size > 50 * 1024 * 1024) throw Error("单个素材不能超过 50 MB");
    const id = uid(),
      metadata: Asset = {
        id,
        name: file.name.slice(0, 200),
        size: file.size,
        contentType: file.type,
        url: "/api/assets/" + id,
      };
    await write("assets", id, { metadata, blob: file });
    remember(id, file);
    return metadata;
  }
  throw Error("离线试用不支持该服务：" + url);
}
