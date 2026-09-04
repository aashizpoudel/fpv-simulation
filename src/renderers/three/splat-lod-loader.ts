export type SplatLodLevel = {
  lod: number;
  file: string;
  splatCount: number;
  bytes: number;
};

export type SplatLodManifest = {
  source?: string;
  levels: SplatLodLevel[];
};

export type SplatSceneViewer = {
  addSplatScene(
    path: string,
    options?: {
      showLoadingUI?: boolean;
      progressiveLoad?: boolean;
      splatAlphaRemovalThreshold?: number;
      onProgress?: (percentage: number, label?: string) => void;
    },
  ): PromiseLike<unknown>;
  removeSplatScene(index: number, showLoadingUI?: boolean): PromiseLike<unknown>;
  getSceneCount(): number;
};

export type SplatLodStatus = {
  state: "loading" | "ready" | "error";
  level?: SplatLodLevel;
  downloadedBytes: number;
  message: string;
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const DEFAULT_DOWNLOAD_BUDGET = 64 * 1024 * 1024;

/**
 * Loads one whole-world, low-resolution KSPLAT before swapping in finer levels.
 * A hard cumulative byte budget prevents an accidentally expanded manifest from
 * making clients download the original multi-gigabyte dataset.
 */
export class SplatLodLoader {
  private manifest?: SplatLodManifest;
  private currentSceneIndex = -1;
  private downloadedBytes = 0;
  private disposed = false;

  constructor(
    private readonly viewer: SplatSceneViewer,
    private readonly manifestUrl: URL,
    private readonly options: {
      fetch?: FetchLike;
      maxDownloadBytes?: number;
      onStatus?: (status: SplatLodStatus) => void;
    } = {},
  ) {}

  public async loadInitial(): Promise<void> {
    this.manifest = await fetchSplatLodManifest(
      this.manifestUrl,
      this.options.fetch,
    );
    await this.loadLevel(this.manifest.levels[0]);
  }

  public async loadFinerLevels(): Promise<void> {
    if (!this.manifest) {
      throw new Error("Call loadInitial() before loadFinerLevels()");
    }
    for (const level of this.manifest.levels.slice(1)) {
      if (this.disposed || !this.fitsDownloadBudget(level)) return;
      await this.loadLevel(level);
    }
  }

  public dispose(): void {
    this.disposed = true;
  }

  private fitsDownloadBudget(level: SplatLodLevel): boolean {
    const budget = this.options.maxDownloadBytes ?? DEFAULT_DOWNLOAD_BUDGET;
    return this.downloadedBytes + level.bytes <= budget;
  }

  private async loadLevel(level: SplatLodLevel): Promise<void> {
    if (!this.fitsDownloadBudget(level)) {
      throw new Error(
        `LOD ${level.lod} exceeds the ${formatMiB(this.options.maxDownloadBytes ?? DEFAULT_DOWNLOAD_BUDGET)} MiB client budget`,
      );
    }

    this.report("loading", level, `Loading Factory LOD ${level.lod}`);
    const nextSceneIndex = this.viewer.getSceneCount();
    const assetUrl = new URL(level.file, this.manifestUrl);
    await this.viewer.addSplatScene(assetUrl.href, {
      showLoadingUI: false,
      progressiveLoad: false,
      splatAlphaRemovalThreshold: 1,
    });

    if (this.disposed) return;
    if (this.currentSceneIndex >= 0) {
      await this.viewer.removeSplatScene(this.currentSceneIndex, false);
      this.currentSceneIndex = nextSceneIndex - 1;
    } else {
      this.currentSceneIndex = nextSceneIndex;
    }
    this.downloadedBytes += level.bytes;
    this.report(
      "ready",
      level,
      `Factory LOD ${level.lod}: ${level.splatCount.toLocaleString()} splats (${formatMiB(level.bytes)} MiB)`,
    );
  }

  private report(
    state: SplatLodStatus["state"],
    level: SplatLodLevel,
    message: string,
  ): void {
    this.options.onStatus?.({
      state,
      level,
      downloadedBytes: this.downloadedBytes,
      message,
    });
  }
}

export async function fetchSplatLodManifest(
  manifestUrl: URL,
  fetcher: FetchLike = fetch,
): Promise<SplatLodManifest> {
  const response = await fetcher(manifestUrl);
  if (!response.ok) {
    throw new Error(
      `Missing splat assets (${response.status}). Run: npm run splat:repack`,
    );
  }
  const value = (await response.json()) as Partial<SplatLodManifest>;
  if (!Array.isArray(value.levels) || value.levels.length === 0) {
    throw new Error("Splat LOD manifest has no levels");
  }
  for (const level of value.levels) {
    if (
      !Number.isInteger(level?.lod) ||
      typeof level?.file !== "string" ||
      !Number.isFinite(level?.splatCount) ||
      !Number.isFinite(level?.bytes) ||
      level.bytes <= 0
    ) {
      throw new Error("Splat LOD manifest contains an invalid level");
    }
  }
  return value as SplatLodManifest;
}

function formatMiB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2);
}
