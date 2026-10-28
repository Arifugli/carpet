import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

// Клиент с service_role: обходит RLS, поэтому используется только на сервере.
export const db = createClient(config.supabaseUrl, config.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
