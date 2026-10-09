import type { createPaths } from "./paths";

type Paths = ReturnType<typeof createPaths>;
interface WorkerEnvironment {
  serviceWorker?: ServiceWorkerContainer;
  documentURL: string;
  baseURI: () => string;
}

// Run synchronously from the blocking injected script, before OpenCode's modules.
// OpenCode's app-scoped or stock root registration call is redirected to this
// app scope. Workers belonging to other apps/scopes are never unregistered.
export async function installVoiceWorker(paths: Paths, environment: WorkerEnvironment = {
  serviceWorker: navigator.serviceWorker,
  documentURL: document.URL,
  baseURI: () => document.baseURI,
}): Promise<ServiceWorkerRegistration | undefined> {
  if (!environment.serviceWorker) return undefined;
  const container = environment.serviceWorker;
  const page = new URL(environment.documentURL);
  const scope = new URL(paths.basePath, page.origin);
  const legacy = new URL("sw.js", scope);
  const stockRoot = new URL("/sw.js", page.origin);
  const voice = new URL(paths.voice("sw.js"), page.origin);
  if (!page.pathname.startsWith(scope.pathname)) return undefined;
  const register = container.register.bind(container);

  async function registerVoice(options?: RegistrationOptions) {
    // getRegistration() can return an ancestor scope; use an exact match instead.
    const existing = (await container.getRegistrations()).find((item) => item.scope === scope.href);
    if (existing) {
      const workers = [existing.active, existing.waiting, existing.installing].filter(
        (worker): worker is ServiceWorker => worker !== null,
      );
      if (!workers.length || workers.some((worker) =>
        worker.scriptURL !== legacy.href && worker.scriptURL !== stockRoot.href && worker.scriptURL !== voice.href)) {
        throw new Error("Voice worker skipped: another service worker owns this app scope.");
      }
    }
    // Registering at the same scope replaces the legacy worker without removing
    // a registration, opening an unprotected interval, or touching other scopes.
    return register(voice.href, { ...options, scope: scope.href, updateViaCache: "none" });
  }

  container.register = (scriptURL, options) => {
    let script: URL;
    let requestedScope: URL;
    try {
      script = new URL(String(scriptURL), environment.baseURI());
      requestedScope = options?.scope === undefined
        ? new URL(".", script)
        : new URL(options.scope, environment.baseURI());
    } catch {
      // Preserve the native API's validation and error behavior for other calls.
      return register(scriptURL, options);
    }
    const appRegistration = script.href === legacy.href && requestedScope.href === scope.href;
    // Stock bundles can still use root-absolute registration URLs when served
    // below a prefix. Redirect that call, not an existing root registration: the
    // installed replacement and cache cleanup remain confined to this app scope.
    const stockRegistration = script.href === stockRoot.href && requestedScope.href === `${page.origin}/`;
    if (appRegistration || stockRegistration) {
      return registerVoice(options);
    }
    return register(scriptURL, options);
  };

  return registerVoice();
}
