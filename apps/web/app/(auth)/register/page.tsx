"use client";
import Link from "next/link";
import { useState } from "react";
import { registerUser } from "@/lib/server-actions/auth";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [devUrl, setDevUrl] = useState<string | null>(null);

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setSubmitting(true);
        setMessage(null);
        const result = await registerUser({ email, password, fullName });
        setSubmitting(false);
        if (result.ok) {
          setMessage("Registrasi berhasil. Cek email kamu untuk link verifikasi.");
          setDevUrl(result.devVerifyUrl);
        } else {
          setMessage(`Gagal: ${result.reason}`);
        }
      }}
    >
      <h1 className="text-2xl font-bold">Daftar Lapakgram</h1>
      <input
        className="w-full rounded border px-3 py-2"
        placeholder="Nama lengkap"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
      />
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
        placeholder="Password (min 8)"
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
        {submitting ? "Mengirim…" : "Daftar"}
      </button>
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}
      {devUrl ? (
        <p className="break-all text-xs text-slate-500">
          Dev verify URL:{" "}
          <a className="underline" href={devUrl}>
            {devUrl}
          </a>
        </p>
      ) : null}
      <p className="text-sm">
        Sudah punya akun?{" "}
        <Link className="underline" href="/login">
          Login
        </Link>
      </p>
    </form>
  );
}
