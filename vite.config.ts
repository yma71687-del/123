import { defineConfig } from "vite";
export default defineConfig({
  root: "frontend",
  define: { __NEXUS_OFFLINE_PREVIEW__: "false" },
  server: { host: "127.0.0.1", proxy: { "/api": "http://127.0.0.1:43121" } },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three", "three/addons/controls/TransformControls.js"],
        },
      },
    },
  },
});
