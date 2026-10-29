const need = (k) => {
  if (!process.env[k]) throw new Error(`Не задана переменная окружения ${k}`);
  return process.env[k];
};
export const config = {
  port: Number(process.env.PORT || 3000),
  supabaseUrl: need('SUPABASE_URL'),
  serviceKey: need('SUPABASE_SERVICE_ROLE_KEY'),
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  bucket: 'carpet-photos',
  requestLogging:process.env.REQUEST_LOGGING!=='false',
  publicBaseUrl:(process.env.PUBLIC_BASE_URL||process.env.RENDER_EXTERNAL_URL)?.replace(/\/$/,''),
  bootstrapEmail:process.env.BOOTSTRAP_ADMIN_EMAIL,bootstrapPassword:process.env.BOOTSTRAP_ADMIN_PASSWORD,
  paymeKey:process.env.PAYME_KEY,paymeMerchantId:process.env.PAYME_MERCHANT_ID,clickSecret:process.env.CLICK_SECRET,clickServiceId:process.env.CLICK_SERVICE_ID,clickMerchantId:process.env.CLICK_MERCHANT_ID,
  externalSecret:process.env.EXTERNAL_FORM_SECRET,externalActor:process.env.EXTERNAL_FORM_ACTOR_ID,
  telephonySecret:process.env.TELEPHONY_SECRET,telephonyActor:process.env.TELEPHONY_ACTOR_ID,
  otpSecret:process.env.OTP_SECRET,notificationKey:process.env.NOTIFICATION_ENCRYPTION_KEY,
  smsToken:process.env.ESKIZ_TOKEN,smsFrom:process.env.ESKIZ_FROM,
  telegramToken:process.env.TELEGRAM_BOT_TOKEN,
  webhookHosts:process.env.WEBHOOK_ALLOWED_HOSTS||'',
  webhookSecrets:Object.fromEntries(Object.entries(process.env).filter(([key])=>/^WEBHOOK_SECRET_[A-Z0-9_]+$/.test(key))),
  workerSend:process.env.WORKER_SEND_ENABLED==='true',
};
