"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createMerchant } from "@/lib/server-actions/merchant";

export default function NewMerchantPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-md p-8">
      <form
        className="space-y-4 rounded-lg bg-white p-6 shadow"
        onSubmit={async (e) => {
          e.preventDefault();
          setSubmitting(true);
          setError(null);
          const result = await createMerchant({
            name,
            slug,
          });
          setSubmitting(false);
          if (result.ok) {
            router.push(`/${result.slug}/settings/bot`);
          } else {
            setError(result.reason);
          }
        }}
      >
        <h1 className="text-2xl font-bold">Buat Toko</h1>
        <input
          className="w-full rounded border px-3 py-2"
          placeholder="Nama toko"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="w-full rounded border px-3 py-2"
          placeholder="slug-toko (huruf kecil, angka, dash)"
          required
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        />
        <button
          type="submit"
          className="w-full rounded bg-slate-900 py-2 font-medium text-white disabled:opacity-50"
          disabled={submitting}
        >
          {submitting ? "…" : "Buat toko & lanjut setup bot"}
        </button>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </form>
    </div>
  );
}
