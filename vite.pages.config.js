import { defineConfig } from "vite";

export default defineConfig({
    root: "examples",
    base: "/blast-physics-js/",
    build: {
        outDir: "../dist-pages",
        emptyOutDir: true
    }
});
