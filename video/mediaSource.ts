import { staticFile } from "remotion";

declare const __NEXUS_AD_OFFLINE_PREVIEW__: boolean;
export const AD_OFFLINE_PREVIEW =
  typeof __NEXUS_AD_OFFLINE_PREVIEW__ !== "undefined" &&
  __NEXUS_AD_OFFLINE_PREVIEW__;
type LocalMedia = typeof globalThis & {
  __NEXUS_AD_MEDIA__?: Record<string, string>;
};
/** Only the explicit standalone build reads embedded/local blob URLs. */
export function publicMedia(path: string) {
  if (!AD_OFFLINE_PREVIEW) return path;
  return (globalThis as LocalMedia).__NEXUS_AD_MEDIA__?.[path] ?? "data:,";
}
export function projectMedia(base: string, id: string) {
  return publicMedia(base + id);
}
export function builtInAudio(path: string) {
  return AD_OFFLINE_PREVIEW ? publicMedia("/" + path) : staticFile(path);
}
export function registerLocalMedia(path: string, url: string) {
  if (!AD_OFFLINE_PREVIEW) return;
  const target = globalThis as LocalMedia;
  (target.__NEXUS_AD_MEDIA__ ??= {})[path] = url;
}
