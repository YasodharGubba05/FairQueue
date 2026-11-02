/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * The api's own origin, for the websocket only.
   *
   * HTTP goes through a same-origin rewrite in the hosted deployment, but a
   * rewrite does not carry a websocket upgrade, so the socket needs the api's
   * real origin. Empty in development, where the page and the api share one.
   */
  readonly VITE_SOCKET_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
