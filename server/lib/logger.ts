/**
 * System logger: console + system_logs table (best-effort, never crashes the process).
 * A DB sink is injected by server/db to avoid a circular dependency.
 */

/** Remove any accidental bot-token pattern from a string before it reaches logs/API responses. */
export function redactToken(text: string): string {
  if (!text) return text;
  return text.replace(/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, '[REDACTED-TOKEN]');
}

type Sink = (level: 'info' | 'warn' | 'error', scope: string, message: string) => void;
let dbSink: Sink | null = null;
const recentErrors: { timestamp: string; scope: string; message: string }[] = [];
export function setLogSink(sink: Sink | null): void {
  dbSink = sink;
}

export function log(level: 'info' | 'warn' | 'error', scope: string, message: string): void {
  const safe = redactToken(message);
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${scope}] ${safe}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);

  if (level === 'error') {
    recentErrors.unshift({ timestamp: new Date().toISOString(), scope, message: safe });
    if (recentErrors.length > 30) recentErrors.length = 30;
  }
  try {
    dbSink?.(level, scope, safe);
  } catch {
    /* logging must never take the process down */
  }
}

export function logError(scope: string, message: string): void {
  log('error', scope, message);
}

export function getRecentErrors(): { timestamp: string; scope: string; message: string }[] {
  return [...recentErrors];
}

export function lastErrorMessage(): string | null {
  return recentErrors.length > 0 ? recentErrors[0].message : null;
}
