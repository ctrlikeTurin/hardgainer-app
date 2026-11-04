// Only the auth part of Supabase is used, so load @supabase/auth-js (~40 KB smaller than supabase-js).
import { AuthClient } from '@supabase/auth-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && key);

// Same storage key supabase-js uses, so existing sign-ins carry over.
export const supabase = isConfigured
  ? {
      auth: new AuthClient({
        url: `${url.replace(/\/$/, '')}/auth/v1`,
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        storageKey: `sb-${new URL(url).hostname.split('.')[0]}-auth-token`,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      }),
    }
  : null;
