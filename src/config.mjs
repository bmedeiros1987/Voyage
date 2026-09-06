const PLACEHOLDERS = new Set(['', 'value', 'changeme', 'placeholder', 'your_value_here']);

export function isConfigured(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return normalized.length > 0 && !PLACEHOLDERS.has(normalized.toLowerCase());
}

export function getRuntimeConfig(env = process.env) {
  const appName = isConfigured(env.APP_NAME) ? env.APP_NAME.trim() : 'Voyage by CrewCheck';
  const appUrl = isConfigured(env.APP_URL) ? env.APP_URL.trim() : 'https://crewcheck.online/voyage';

  return Object.freeze({
    nodeEnv: env.NODE_ENV || 'development',
    port: Number(env.PORT || 10000),
    appName,
    appUrl,
    databaseConfigured: isConfigured(env.DATABASE_URL),
    google: Object.freeze({
      loginConfigured: isConfigured(env.GOOGLE_CLIENT_ID) && isConfigured(env.GOOGLE_CLIENT_SECRET),
      redirectConfigured: isConfigured(env.GOOGLE_REDIRECT_URI),
      gmailConfigured:
        isConfigured(env.GOOGLE_CLIENT_ID) &&
        isConfigured(env.GOOGLE_CLIENT_SECRET) &&
        isConfigured(env.GOOGLE_REDIRECT_URI) &&
        isConfigured(env.TOKEN_ENCRYPTION_KEY),
      pubsubConfigured:
        isConfigured(env.GOOGLE_PUBSUB_TOPIC) && isConfigured(env.GOOGLE_PUBSUB_AUDIENCE)
    })
  });
}

export function publicConfig(config = getRuntimeConfig()) {
  return {
    appName: config.appName,
    appUrl: config.appUrl,
    environment: config.nodeEnv,
    integrations: {
      googleLogin: config.google.loginConfigured,
      gmailTravelImport: config.google.gmailConfigured,
      gmailPushSync: config.google.gmailConfigured && config.google.pubsubConfigured
    }
  };
}
