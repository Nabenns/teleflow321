import { desc } from "drizzle-orm";
import { schema } from "@lapakgram/db";
import { getDb } from "@/lib/db";

export default async function AdminMerchantsPage() {
  const db = getDb();
  const merchants = await db
    .select({
      id: schema.merchants.id,
      slug: schema.merchants.slug,
      name: schema.merchants.name,
      status: schema.merchants.status,
      botUsername: schema.merchants.botUsername,
      createdAt: schema.merchants.createdAt,
    })
    .from(schema.merchants)
    .orderBy(desc(schema.merchants.createdAt));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Merchants ({merchants.length})</h1>
      <table className="w-full table-auto rounded bg-white shadow">
        <thead className="bg-slate-100 text-left text-sm">
          <tr>
            <th className="px-3 py-2">Slug</th>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Bot</th>
            <th className="px-3 py-2">Created</th>
          </tr>
        </thead>
        <tbody>
          {merchants.map((m) => (
            <tr key={m.id} className="border-t text-sm">
              <td className="px-3 py-2 font-mono">{m.slug}</td>
              <td className="px-3 py-2">{m.name}</td>
              <td className="px-3 py-2">
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    m.status === "active"
                      ? "bg-green-100 text-green-800"
                      : "bg-slate-200 text-slate-700"
                  }`}
                >
                  {m.status}
                </span>
              </td>
              <td className="px-3 py-2">{m.botUsername ? `@${m.botUsername}` : "-"}</td>
              <td className="px-3 py-2">{m.createdAt.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
