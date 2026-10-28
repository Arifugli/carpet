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
};
