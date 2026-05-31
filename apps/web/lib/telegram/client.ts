const BASE = "https://api.telegram.org";

export interface GetMeResult {
  ok: boolean;
  result?: { id: number; is_bot: boolean; username: string; first_name: string };
  description?: string;
}

export async function getMe(token: string): Promise<GetMeResult> {
  // A network exception (DNS failure, ECONNREFUSED, timeout) must become an
  // ok:false result, not a thrown rejection — callers rely on the discriminated
  // union and would otherwise leave the merchant in a half-configured state.
  try {
    const r = await fetch(`${BASE}/bot${token}/getMe`, { method: "GET" });
    return (await r.json()) as GetMeResult;
  } catch {
    return { ok: false, description: "network error contacting Telegram" };
  }
}

export interface SetWebhookOptions {
  url: string;
  secretToken?: string;
  dropPendingUpdates?: boolean;
}

export interface SetWebhookResult {
  ok: boolean;
  description?: string;
}

export async function setWebhook(
  token: string,
  options: SetWebhookOptions,
): Promise<SetWebhookResult> {
  const body = new URLSearchParams();
  body.set("url", options.url);
  if (options.secretToken) body.set("secret_token", options.secretToken);
  if (options.dropPendingUpdates) body.set("drop_pending_updates", "true");
  // Convert network exceptions into ok:false so the caller's rollback path
  // runs instead of the action rejecting and skipping cleanup.
  try {
    const r = await fetch(`${BASE}/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    return (await r.json()) as SetWebhookResult;
  } catch {
    return { ok: false, description: "network error contacting Telegram" };
  }
}

export async function deleteWebhook(token: string): Promise<SetWebhookResult> {
  try {
    const r = await fetch(`${BASE}/bot${token}/deleteWebhook`, { method: "POST" });
    return (await r.json()) as SetWebhookResult;
  } catch {
    return { ok: false, description: "network error contacting Telegram" };
  }
}
