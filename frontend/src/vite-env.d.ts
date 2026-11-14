/// <reference types="vite/client" />

/** Подставляется в vite.config.ts: true — запросы к API перехватывают моки. */
declare const __API_MOCKS__: boolean;

interface ImportMetaEnv {
  /** Адрес настоящего API, например http://localhost:8000/api/v1 */
  readonly VITE_API_URL?: string;
  /** true | false — принудительно включить или выключить моки */
  readonly VITE_API_MOCKS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
