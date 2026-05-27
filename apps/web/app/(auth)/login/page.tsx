"use client";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { TelegramLogin } from "./_components/telegram-login";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME ?? "";

  return (
    <div className="space-y-6">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setSubmitting(true);
          setError(null);
          const res = await signIn("credentials", {
            email,
            password,
            redirect: false,
          });
          setSubmitting(false);
          if (res?.error) {
            setError("Email atau password salah, atau email belum diverifikasi.");
          } else if (res?.ok) {
            window.location.href = "/new-merchant";
          }
        }}
      >
        <h1 className="text-2xl font-bold">Masuk</h1>
        <input
          className="w-full rounded border px-3 py-2"
          placeholder="Email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="w-full rounded border px-3 py-2"
          placeholder="Password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button
          type="submit"
          className="w-full rounded bg-slate-900 py-2 font-medium text-white disabled:opacity-50"
          disabled={submitting}
        >
          {submitting ? "…" : "Masuk"}
        </button>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </form>

      <div className="flex items-center gap-3">
        <div className="flex-1 border-t" />
        <span className="text-xs uppercase text-slate-500">atau</span>
        <div className="flex-1 border-t" />
      </div>

      <div className="flex justify-center">
        <TelegramLogin botUsername={botUsername} />
      </div>

      <p className="text-sm">
        Belum punya akun?{" "}
        <Link className="underline" href="/register">
          Daftar
        </Link>
      </p>
    </div>
  );
}
