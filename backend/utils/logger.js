const logInfo = (module, message, meta = '') => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [INFO] [${module}] ${message}`, meta ? JSON.stringify(meta) : '');
};

const logWarn = (module, message, meta = '') => {
  const ts = new Date().toISOString();
  console.warn(`[${ts}] [WARN] [${module}] ⚠️ ${message}`, meta ? JSON.stringify(meta) : '');
};

const logError = (module, message, error = '') => {
  const ts = new Date().toISOString();
  console.error(`[${ts}] [ERROR] [${module}] ❌ ${message}`, error);
};

const logSecurity = (module, event, ip = '', outcome = '') => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [SECURITY-AUDIT] [${module}] [${outcome}] Event: ${event} | IP: ${ip}`);
};

module.exports = {
  logInfo,
  logWarn,
  logError,
  logSecurity
};

