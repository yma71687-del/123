declare const __NEXUS_OFFLINE_PREVIEW__: boolean;
export const OFFLINE_PREVIEW =
  typeof __NEXUS_OFFLINE_PREVIEW__ !== "undefined" && __NEXUS_OFFLINE_PREVIEW__;
export const storageLabel = OFFLINE_PREVIEW ? "本机" : "云端";
