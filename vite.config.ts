import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const cesiumSource = "node_modules/cesium/Build/Cesium";
const cesiumBaseUrl = "cesium";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_BASE_PATH");
  const configuredBase = env.VITE_BASE_PATH || "/";
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
    server: {
      host: "127.0.0.1",
      allowedHosts: [".ts.net"],
    },
    preview: {
      host: "127.0.0.1",
      allowedHosts: [".ts.net"],
    },
    test: {
      environment: "jsdom",
      setupFiles: ["tests/setup.ts"],
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
