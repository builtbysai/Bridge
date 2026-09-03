/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SIGNALING_URL?: string;
  readonly VITE_BRIDGE_STUN_URLS?: string;
  readonly VITE_BRIDGE_TURN_URLS?: string;
  readonly VITE_BRIDGE_TURN_USERNAME?: string;
  readonly VITE_BRIDGE_TURN_CREDENTIAL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
