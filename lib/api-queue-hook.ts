/** The hosted API wrapper wakes only work already authorized and saved by a route.
 * This module neither creates jobs nor calls a provider. Node uses its own worker. */
const DIRECT_ENQUEUE_PATHS = new Set([
  'generate', 'generate-storyboard', 'generate-speech', 'generate-remaining', 'generate-locations',
  'generate-lipsync', 'generate-voice-tests', 'media-review', 'queue',
]);
const ACTIONS: Record<string, ReadonlySet<string>> = {
  directing: new Set(['run', 'scriptRun', 'resumeScriptRun', 'retry', 'advance']),
  world: new Set(['generateActor']),
  music: new Set(['ideas', 'generate']),
  'voice-design': new Set(['design', 'proposeDelivery', 'saveVoice', 'advance']),
  soundscape: new Set(['generate', 'advance']),
  // Selecting/reviewing approved frames can make existing authorized work ready.
  keyframes: new Set(['mode', 'select', 'review', 'approve']),
};
const PROJECT = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ROUTE = new RegExp('^/api/projects/(' + PROJECT + ')/([a-z-]+)(?:/(' + PROJECT + '))?/?$', 'i');

export function queueHookProject(method: string, pathname: string, body?: unknown): string | undefined {
  if (method !== 'POST') return;
  const matched = ROUTE.exec(pathname);
  if (!matched) return;
  const [, projectId, route, jobId] = matched;
  const action = typeof body === 'object' && body !== null && 'action' in body
    ? (body as { action?: unknown }).action : undefined;
  if (route === 'jobs') {
    // The watchdog is deliberately read/reconciliation only. Never dispatch a
    // different queued attempt merely because the browser checked a timeout.
    if (jobId && (action === undefined || ['resume-wait', 'recover-result', 'recover-voice-file'].includes(String(action)))) return projectId;
    return;
  }
  if (jobId) return;
  if (DIRECT_ENQUEUE_PATHS.has(route) || typeof action === 'string' && ACTIONS[route]?.has(action)) return projectId;
}

/** Capture before route.json() consumes the body. No reads for GET/uploads or
 * unrelated routes; parsing a clone never changes the route's input stream. */
export async function captureQueueHook(req: Request): Promise<string | undefined> {
  if (req.method !== 'POST') return;
  let pathname: string;
  try { pathname = new URL(req.url).pathname; } catch { return; }
  const matched = ROUTE.exec(pathname);
  if (!matched) return;
  const route = matched[2];
  if (DIRECT_ENQUEUE_PATHS.has(route)) return queueHookProject(req.method, pathname);
  if (route !== 'jobs' && !ACTIONS[route]) return;
  let body: unknown;
  try { body = await req.clone().json(); } catch { body = undefined; }
  return queueHookProject(req.method, pathname, body);
}
