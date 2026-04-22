import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const configDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "/assets/",
  build: {
    assetsDir: ".",
    cssCodeSplit: false,
    emptyOutDir: true,
    outDir: resolve(configDir, "../../dist/ui/web/assets"),
    rollupOptions: {
      input: resolve(configDir, "src/main.tsx"),
      output: {
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith(".css") ? "portal.css" : "[name][extname]",
        chunkFileNames: "portal-[hash].js",
        entryFileNames: "portal.js"
      }
    },
    sourcemap: true,
    target: "es2022"
  },
  publicDir: false,
  plugins: [react()]
});
