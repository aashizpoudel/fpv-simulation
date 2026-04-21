import { defineConfig } from "vitest/config";
import { viteStaticCopy } from "vite-plugin-static-copy";

const cesiumSource = "node_modules/cesium/Build/Cesium";
const cesiumBaseUrl = "cesium";

export default defineConfig({
  base: "/fpv-simulation/",
  define: {
    CESIUM_BASE_URL: JSON.stringify(`/fpv-simulation/${cesiumBaseUrl}/`),
  },
  build: {
    outDir: "build",
  },
  test: {
    environment: "jsdom",
  },
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: `${cesiumSource}/**/*`,
          dest: cesiumBaseUrl,
        },
      ],
    }),
  ],
});
