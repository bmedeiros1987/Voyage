const PLACEHOLDERS = new Set(['', 'value', 'changeme', 'placeholder', 'your_value_here']);

export function isConfigured(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return normalized.length > 0 && !PLACEHOLDERS.has(normalized.toLowerCase());
}

export function getRuntimeConfig(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || 'development').trim().toLowerCase();
  const appName = isConfigured(env.APP_NAME) ? env.APP_NAME.trim() : 'Voyage by CrewCheck';
  const appUrl = isConfigured(env.APP_URL) ? env.APP_URL.trim() : 'https://crewcheck.online/voyage';
  const sessionSigningKey = isConfigured(env.SESSION_SIGNING_KEY) && env.SESSION_SIGNING_KEY.trim().length >= 32 ? env.SESSION_SIGNING_KEY.trim() : null;
  const googleClientId = isConfigured(env.GOOGLE_CLIENT_ID) ? env.GOOGLE_CLIENT_ID.trim() : null;
  const googleClientSecret = isConfigured(env.GOOGLE_CLIENT_SECRET) ? env.GOOGLE_CLIENT_SECRET.trim() : null;
  const googleRedirectUri = isConfigured(env.GOOGLE_REDIRECT_URI) ? env.GOOGLE_REDIRECT_URI.trim() : null;
  const tokenEncryptionKey = isConfigured(env.TOKEN_ENCRYPTION_KEY) ? env.TOKEN_ENCRYPTION_KEY.trim() : null;
  const tokenKeyVersion = isConfigured(env.TOKEN_KEY_VERSION) ? env.TOKEN_KEY_VERSION.trim() : 'v1';
  const pubsubServiceAccountEmail = isConfigured(env.GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL)
    ? env.GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL.trim().toLowerCase()
    : null;
  const pubsubConfigured =
    isConfigured(env.GOOGLE_PUBSUB_TOPIC) &&
    isConfigured(env.GOOGLE_PUBSUB_AUDIENCE) &&
    Boolean(pubsubServiceAccountEmail);

  if (nodeEnv === 'production' && !sessionSigningKey) {
    throw configurationError('session_signing_key_required');
  }

  return Object.freeze({
    nodeEnv,
    port: Number(env.PORT || 10000),
    appName,
    appUrl,
    databaseConfigured: isConfigured(env.DATABASE_URL),
    session: Object.freeze({
      configured: Boolean(sessionSigningKey),
      signingKey: sessionSigningKey
    }),
    google: Object.freeze({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      redirectUri: googleRedirectUri,
      tokenEncryptionKey,
      tokenKeyVersion,
      loginConfigured: Boolean(googleClientId && googleClientSecret),
      redirectConfigured: Boolean(googleRedirectUri),
      gmailConfigured: Boolean(googleClientId && googleClientSecret && googleRedirectUri && tokenEncryptionKey),
      pubsubConfigured,
      pubsubAudience: isConfigured(env.GOOGLE_PUBSUB_AUDIENCE) ? env.GOOGLE_PUBSUB_AUDIENCE.trim() : null,
      pubsubServiceAccountEmail
    }),
    sharedCrewCheck: Object.freeze({
      configured:
        isConfigured(env.CREWCHECK_SHARED_API_BASE_URL) &&
        isConfigured(env.CREWCHECK_SHARED_SERVICES_TOKEN),
      baseUrl: isConfigured(env.CREWCHECK_SHARED_API_BASE_URL) ? env.CREWCHECK_SHARED_API_BASE_URL.trim() : null
    }),
    awesomeApi: Object.freeze({
      configured: isConfigured(env.AWESOMEAPI_API_KEY) || isConfigured(env.AWESOME_API_KEY)
    })
  });
}

export function publicConfig(config = getRuntimeConfig()) {
  return {
    appName: config.appName,
    appUrl: config.appUrl,
    environment: config.nodeEnv,
    integrations: {
      authenticatedSession: config.session.configured,
      googleLogin: config.google.loginConfigured,
      gmailTravelImport: config.google.gmailConfigured,
      gmailPushSync: config.google.gmailConfigured && config.google.pubsubConfigured,
      crewCheckSharedServices: config.sharedCrewCheck.configured,
      awesomeApiDirectFallback: config.awesomeApi.configured,
      fxAndCepReady: config.sharedCrewCheck.configured || config.awesomeApi.configured
    }
  };
}

function configurationError(code) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = 500;
  return error;
}
