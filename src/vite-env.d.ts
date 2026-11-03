// hi
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** FastAPI backend URL. When unset, services use mock data. */
  readonly VITE_API_URL?: string;
}
