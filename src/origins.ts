export const APP_ORIGIN = 'https://app.turbobulls.com'
/** The app's local development server, allowed only in development builds. */
export const DEV_ORIGIN = 'http://localhost:3000'

/** The only web pages that may message the extension. */
export function allowedOrigins(mode: string): string[] {
  return mode === 'development' ? [APP_ORIGIN, DEV_ORIGIN] : [APP_ORIGIN]
}
