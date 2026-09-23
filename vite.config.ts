import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const cesiumSource = "node_modules/cesium/Build/Cesium";
const cesiumBaseUrl = "cesium";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_BASE_PATH");
  const configuredBase = env.VITE_BASE_PATH || "/fpv-simulation/";
  const path = configuredBase.replace(/^\/+|\/+$/g, "");
  const base = path ? `/${path}/` : "/";

  return {
    base,
    define: {
      CESIUM_BASE_URL: JSON.stringify(`${base}${cesiumBaseUrl}/`),
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
  };
});
