const order = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(level = 'info') {
  const threshold = order[level] ?? 20;
  const emit = (name, message, meta = {}) => {
    if ((order[name] ?? 20) < threshold) return;
    const line = { ts: new Date().toISOString(), level: name, message, ...meta };
    const fn = name === 'error' ? console.error : name === 'warn' ? console.warn : console.log;
    fn(JSON.stringify(line));
  };
  return {
    debug: (m, meta) => emit('debug', m, meta),
    info: (m, meta) => emit('info', m, meta),
    warn: (m, meta) => emit('warn', m, meta),
    error: (m, meta) => emit('error', m, meta)
  };
}
