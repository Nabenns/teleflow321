"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { setupBotForMerchant } from "@/lib/server-actions/bot";

export function BotSetupClient({
  merchantId,
  merchantSlug,
  currentBotUsername,
}: {
  merchantId: string;
  merchantSlug: string;
  currentBotUsername: string | null;
}) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<
    { ok: true; botUsername: string } | { ok: false; reason: string } | null
  >(null);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Setup bot Telegram</h1>
        {currentBotUsername ? (
          <p className="text-sm text-slate-600">
            Bot saat ini: <code>@{currentBotUsername}</code>. Paste token baru untuk ganti.
          </p>
        ) : (
          <p className="text-sm text-slate-600">
            Buat bot baru di{" "}
            <Link className="underline" href="https://t.me/BotFather" target="_blank">
              @BotFather
            </Link>
            , lalu paste token-nya.
          </p>
        )}
        <ol className="list-decimal pl-6 text-sm text-slate-700">
          <li>Buka chat dengan @BotFather di Telegram</li>
          <li>
            Kirim <code>/newbot</code> dan ikuti instruksi (nama + username)
          </li>
          <li>
            BotFather akan kasih token format <code>123456:ABC-...</code>
          </li>
          <li>Paste token-nya di form di bawah</li>
        </ol>
      </div>

      <form
        className="space-y-4 rounded-lg bg-white p-6 shadow"
        onSubmit={async (e) => {
          e.preventDefault();
          setSubmitting(true);
          setResult(null);
          try {
            const r = await setupBotForMerchant({ merchantId, botToken: token });
            setResult(r);
            if (r.ok) {
              setTimeout(() => router.push(`/${merchantSlug}`), 1500);
            }
          } catch {
            // Defensive: the action returns a typed result, but a transport
            // error must not leave the button stuck on "Memvalidasi…".
            setResult({ ok: false, reason: "Terjadi kesalahan. Coba lagi." });
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <input
          className="w-full rounded border px-3 py-2 font-mono text-sm"
          placeholder="123456:ABC-DEF1234ghIkl-..."
          required
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <button
          type="submit"
          className="w-full rounded bg-slate-900 py-2 font-medium text-white disabled:opacity-50"
          disabled={submitting}
        >
          {submitting ? "Memvalidasi…" : "Connect bot"}
        </button>
        {result?.ok ? (
          <p className="text-sm text-green-700">✓ Bot @{result.botUsername} terhubung.</p>
        ) : null}
        {result && !result.ok ? (
          <p className="text-sm text-red-600">Gagal: {result.reason}</p>
        ) : null}
      </form>
    </div>
  );
}
