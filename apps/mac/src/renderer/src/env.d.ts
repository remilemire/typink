/// <reference types="vite/client" />
import type { TypinkApi } from '@shared/api';

declare global {
  interface Window {
    typink: TypinkApi;
  }
}
