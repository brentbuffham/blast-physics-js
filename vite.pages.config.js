import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
    root: "examples",
    base: "/blast-physics-js/",
    build: {
        outDir: "../dist-pages",
        emptyOutDir: true,
        target: "esnext",
        rollupOptions: {
            input: {
                index: resolve(__dirname, "examples/index.html"),
                analysis: resolve(__dirname, "examples/analysis.html"),
                throw: resolve(__dirname, "examples/throw.html"),
                ripple: resolve(__dirname, "examples/ripple.html")
            }
        }
    }
});
