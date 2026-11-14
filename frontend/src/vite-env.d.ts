/// <reference types="vite/client" />

/** Set in vite.config.ts: true means the mocks intercept API requests. */
declare const __API_MOCKS__: boolean;

interface ImportMetaEnv {
  /** Address of the real API, for example http://localhost:8000/api/v1 */
  readonly VITE_API_URL?: string;
  /** true | false: force the mocks on or off */
  readonly VITE_API_MOCKS?: string;
  /** auto | only | off: when to show the saved answers of public/snapshot instead of the server */
  readonly VITE_API_FALLBACK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
