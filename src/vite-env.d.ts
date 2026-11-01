/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** wss:// URL of the co-op relay (server/). Unset = co-op unavailable. */
  readonly VITE_RELAY_URL?: string;
}
