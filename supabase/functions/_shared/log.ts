export function makeLogger(requestId: string, route: string) {
  const base = { request_id: requestId, route }
  return {
    info: (msg: string, extra: Record<string, unknown> = {}) =>
      console.log(JSON.stringify({ level: 'info', msg, ...base, ...extra })),
    warn: (msg: string, extra: Record<string, unknown> = {}) =>
      console.warn(JSON.stringify({ level: 'warn', msg, ...base, ...extra })),
    error: (msg: string, extra: Record<string, unknown> = {}) =>
      console.error(JSON.stringify({ level: 'error', msg, ...base, ...extra })),
  }
}
export type Logger = ReturnType<typeof makeLogger>
