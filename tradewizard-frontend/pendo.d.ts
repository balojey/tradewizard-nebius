/* eslint-disable no-var */
declare global {
  interface PendoApi {
    initialize(options: Record<string, unknown>): void;
    identify(options: Record<string, unknown>): void;
    clearSession(): void;
  }

  var pendo: PendoApi;
}

export {};
