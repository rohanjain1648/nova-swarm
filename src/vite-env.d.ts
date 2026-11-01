/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** wss:// URL of the co-op relay (server/). Unset = co-op unavailable. */
  readonly VITE_RELAY_URL?: string;
  /** Public site URL for invite links, when the page's own URL can't be opened by others (the app). */
  readonly VITE_PUBLIC_URL?: string;
}
