/** Public mount paths are configuration, never inferred from proxy headers or page routes. */
export function normalizeBasePath(value: unknown = "/"): string {
  if (typeof value !== "string" || value.length > 2048 ||
      !/^\/(?:[A-Za-z0-9_~-]+(?:\.[A-Za-z0-9_~-]+)*\/)*[A-Za-z0-9_~-]*(?:\.[A-Za-z0-9_~-]+)*\/?$/.test(value) ||
      value.includes("//") || value.split("/").some(part => part === "." || part === "..")) {
    throw new Error("basePath must be an absolute path of safe segments, without escapes, query, fragment, or traversal.");
  }
  return value.endsWith("/") ? value : `${value}/`;
}

export function createPaths(value: unknown = "/") {
  const basePath = normalizeBasePath(value);
  const voiceBasePath = `${basePath}voice/`;
  function voice(relative = "") {
    if (relative !== "" && !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*(?:\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)*$/.test(relative)) {
      throw new Error("Voice URL must be a relative plugin path.");
    }
    return `${voiceBasePath}${relative}`;
  }
  return { basePath, voiceBasePath, voice };
}

export type ProxyMode = "preserve" | "strip";
export function normalizeProxyMode(value: unknown = "preserve"): ProxyMode {
  if (value !== "preserve" && value !== "strip") throw new Error("proxyMode must be preserve or strip.");
  return value;
}

/** Translate only the explicitly configured external mount into canonical internal routes. */
export function internalPath(path: string, basePath: string, mode: ProxyMode): string | null {
  if (mode === "strip" || basePath === "/") return path;
  if (path === basePath.slice(0, -1)) return "/";
  return path.startsWith(basePath) ? `/${path.slice(basePath.length)}` : null;
}
