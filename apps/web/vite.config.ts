import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  build: {
    emptyOutDir: true,
    target: "es2023",
  },
});
