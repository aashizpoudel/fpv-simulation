import { defineConfig } from "vitest/config";
import { viteStaticCopy } from "vite-plugin-static-copy";

const cesiumSource = "node_modules/cesium/Build/Cesium";
const cesiumBaseUrl = "cesium";

export default defineConfig({
  define: {
    CESIUM_BASE_URL: JSON.stringify(`/${cesiumBaseUrl}`),
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
