import { OFFLINE_PREVIEW } from "./mode";
import { offlineAPI, offlineAssetURL, prepareOfflineAssets } from "./offline";
import type { Asset } from "./schema";
export const BACKUP_KEY = "nexus-project-v3"; // Preserve existing browser backups across schema migration.
export function assetURL(asset: Pick<Asset, "id" | "url">) {
  return OFFLINE_PREVIEW ? offlineAssetURL(asset.id) : asset.url;
}
export async function prepareAssets(assets: Asset[]) {
  if (OFFLINE_PREVIEW) await prepareOfflineAssets(assets);
}
export async function api<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  if (OFFLINE_PREVIEW) return offlineAPI(url, options) as Promise<T>;
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
  return body as T;
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
