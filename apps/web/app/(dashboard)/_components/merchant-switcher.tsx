"use client";

import Link from "next/link";
import { useState } from "react";
import type { MerchantListItem } from "@/lib/server-actions/merchant";

export function MerchantSwitcher({
  items,
  active,
}: {
  items: MerchantListItem[];
  active: string;
}) {
  const [open, setOpen] = useState(false);
  if (items.length <= 1) return null;
  return (
    <div className="relative">
      <button
        type="button"
        className="rounded border px-3 py-1 text-sm"
        onClick={() => setOpen((o) => !o)}
      >
        Switch ▾
      </button>
      {open ? (
        <ul className="absolute z-10 mt-1 min-w-[200px] rounded border bg-white shadow">
          {items.map((m) => (
            <li key={m.merchantId}>
              <Link
                href={`/${m.slug}`}
                className={`block px-3 py-2 text-sm hover:bg-slate-100 ${
                  m.slug === active ? "font-bold" : ""
                }`}
              >
                {m.name}
              </Link>
            </li>
          ))}
          <li className="border-t">
            <Link
              href="/new-merchant"
              className="block px-3 py-2 text-sm hover:bg-slate-100"
            >
              + Buat toko baru
            </Link>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
