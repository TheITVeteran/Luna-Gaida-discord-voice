/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AVATAR_RENDERER?: 'live2d' | 'vrm';
  readonly VITE_LIVE2D_MODEL_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
