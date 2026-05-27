import Link from "next/link";
import { consumeEmailVerification } from "@/lib/server-actions/auth";

interface Props {
  searchParams: Promise<{ token?: string }>;
}

export default async function VerifyEmailPage({ searchParams }: Props) {
  const { token } = await searchParams;
  if (!token) {
    return <p>Token tidak ditemukan.</p>;
  }
  const result = await consumeEmailVerification(token);
  if (!result.ok) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-bold">Verifikasi gagal</h1>
        <p>{result.reason}</p>
        <Link className="underline" href="/login">
          Kembali ke login
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">Email diverifikasi ✓</h1>
      <p>Sekarang kamu bisa masuk.</p>
      <Link className="underline" href="/login">
        Lanjut ke login
      </Link>
    </div>
  );
}
