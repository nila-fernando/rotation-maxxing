// Signing in with a magic link (Supabase Auth). Nothing here blocks the app: supabase-js is only
// loaded when someone opens the account panel, has signed in before on this device, or is coming
// back from a sign-in link. Signed-out visitors and the demo never touch it.
//
//   const auth = createAuth({ url, key, redirectTo })
//   auth.init()                 -> { user, linkError }   (picks up a session or a sign-in link)
//   auth.sendLink(email)        -> { ok: true } | { ok: false, reason, message }
//   auth.signOut()   auth.onChange(fn)   auth.user   auth.client()

/** Why a magic link couldn't be sent, from Supabase's error. */
export function linkErrorReason(err) {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  if (err?.status === 429 || /rate.?limit|too many|over_email_send/i.test(code + msg)) return 'rate';
  if (/email_address_invalid|validation_failed|invalid.*email|email.*invalid|unable to validate email/i.test(code + msg)) return 'email';
  if (/signup_disabled|signups? not allowed/i.test(code + msg)) return 'closed';
  if (!err?.status || /fetch|network|load failed/i.test(msg) || err?.name === 'AuthRetryableFetchError') return 'network';
  return 'other';
}

/** A sign-in link that came back with an error in the URL (expired, already used). */
export function urlLinkError(hash = '', search = '') {
  const p = new URLSearchParams(String(hash).replace(/^#/, ''));
  const q = new URLSearchParams(String(search).replace(/^\?/, ''));
  const code = p.get('error_code') || q.get('error_code') || p.get('error') || q.get('error');
  if (!code) return null;
  return { code, expired: /otp_expired|expired/i.test(code + (p.get('error_description') || q.get('error_description') || '')) };
}

const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/**
 * @param {{ url: string, key: string, redirectTo: () => string, storage?: () => Storage }} o
 */
export function createAuth({ url, key, redirectTo, storage = () => globalThis.localStorage }) {
  let client = null;
  let loading = null;
  let user = null;
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => { try { fn(user); } catch (e) { console.error(e); } });

  /** A session from before is stored on this device (supabase-js keeps it as sb-<ref>-auth-token). */
  function hasStoredSession() {
    try {
      const s = storage();
      for (let i = 0; i < s.length; i++) if (/^sb-.+-auth-token$/.test(s.key(i) || '')) return true;
    } catch { /* no storage: no session */ }
    return false;
  }
  const comingBack = () => /(^|[#&?])(access_token|error_code|error_description)=/.test(location.hash + location.search);

  function load() {
    loading ??= import('@supabase/supabase-js').then(({ createClient }) => {
      client = createClient(url, key, {
        auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
      });
      client.auth.onAuthStateChange((_event, session) => {
        const next = session?.user ? { id: session.user.id, email: session.user.email } : null;
        if (next?.id === user?.id && next?.email === user?.email) return;
        user = next;
        // (supabase-js asks that its own calls aren't awaited inside this callback)
        setTimeout(emit, 0);
      });
      return client;
    });
    return loading;
  }

  /** Clears the sign-in link's tokens or error from the address bar, keeping the rest. */
  function cleanUrl() {
    try {
      const u = new URL(location.href);
      const strip = (p) => { for (const k of ['access_token', 'refresh_token', 'expires_in', 'expires_at', 'token_type', 'type', 'provider_token', 'error', 'error_code', 'error_description', 'sb']) p.delete(k); };
      const hash = new URLSearchParams(u.hash.replace(/^#/, ''));
      strip(hash);
      strip(u.searchParams);
      u.hash = hash.toString();
      history.replaceState(history.state, '', u.toString().replace(/#$/, ''));
    } catch { /* leave it */ }
  }

  return {
    get user() { return user; },
    /** Whether supabase-js is needed at load (a session or a sign-in link is waiting). */
    get pending() { return hasStoredSession() || comingBack(); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    client: load,
    /** Picks up a stored session or a sign-in link. Never throws. */
    async init({ force = false } = {}) {
      const back = comingBack();
      const linkError = back ? urlLinkError(location.hash, location.search) : null;
      if (!force && !back && !hasStoredSession()) return { user: null, linkError: null };
      try {
        const c = await load();
        const { data } = await c.auth.getSession();
        user = data?.session?.user ? { id: data.session.user.id, email: data.session.user.email } : null;
      } catch (e) {
        console.warn('Sign-in: could not restore the session', e);
      }
      if (back) cleanUrl();
      return { user, linkError, justSignedIn: back && !linkError && !!user };
    },
    async sendLink(email) {
      const clean = String(email || '').trim();
      if (!looksLikeEmail(clean)) return { ok: false, reason: 'email' };
      try {
        const c = await load();
        const { error } = await c.auth.signInWithOtp({ email: clean, options: { emailRedirectTo: redirectTo(), shouldCreateUser: true } });
        if (error) return { ok: false, reason: linkErrorReason(error), message: error.message };
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: linkErrorReason(e), message: e?.message };
      }
    },
    async signOut() {
      try {
        const c = await load();
        await c.auth.signOut({ scope: 'local' });
      } catch (e) {
        console.warn('Sign out', e);
      }
      user = null;
      emit();
    },
  };
}
