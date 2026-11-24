// Public settings of the cloud sync (not secret: they are part of the app anyway).

/** OAuth client of "Sign in with Google" (Google Auth Platform, project of the user). */
export const GOOGLE_CLIENT_ID = "893078474081-c8u2digpl05ts28upu7mdcnslrrhsvlk.apps.googleusercontent.com";

/** The sync server (IONOS VPS, Caddy with HTTPS in front of tools/sync-server.ts). */
export const SYNC_ORIGIN = "https://1bwv2ku.cserverhost.cloud";

export const SYNC_PORT = 8790;
