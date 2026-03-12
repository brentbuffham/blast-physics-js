import { defineConfig } from "vite";

export default defineConfig({
    build: {
        lib: {
            entry: "src/index.js",
            name: "BlastPhysics",
            formats: ["es", "cjs"],
            fileName: (format) => format === "es" ? "blast-physics-js.js" : "blast-physics-js.cjs"
        },
        rollupOptions: {
            external: [],
        }
    },
    test: {
        environment: "node"
    }
});
