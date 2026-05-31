"use client";
import { useState } from "react";
import {
  inviteMember,
  changeMemberRole,
  removeMember,
  type MemberRow,
} from "@/lib/server-actions/members";
import type { Role } from "@/lib/permissions";

export function TeamClient({
  merchantId,
  members: initialMembers,
  actorUserId,
}: {
  merchantId: string;
  members: MemberRow[];
  actorUserId: string;
}) {
  const [members, setMembers] = useState(initialMembers);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("support");
  const [inviteResult, setInviteResult] = useState<string | null>(null);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-2xl font-bold">Team</h1>
        <table className="w-full table-auto rounded bg-white shadow">
          <thead className="bg-slate-100 text-left text-sm">
            <tr>
              <th className="px-3 py-2">Nama</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId} className="border-t text-sm">
                <td className="px-3 py-2">{m.fullName ?? "-"}</td>
                <td className="px-3 py-2">{m.email ?? "-"}</td>
                <td className="px-3 py-2">
                  <select
                    className="rounded border px-2 py-1"
                    value={m.role}
                    disabled={m.userId === actorUserId}
                    onChange={async (e) => {
                      const newRole = e.target.value as Role;
                      const r = await changeMemberRole({
                        merchantId,
                        targetUserId: m.userId,
                        newRole,
                      });
                      if (r.ok) {
                        setMembers((prev) =>
                          prev.map((p) =>
                            p.userId === m.userId ? { ...p, role: newRole } : p,
                          ),
                        );
                      }
                    }}
                  >
                    {(["admin", "finance", "support"] as Role[]).map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                    {m.role === "owner" ? <option value="owner">owner</option> : null}
                  </select>
                </td>
                <td className="px-3 py-2 text-right">
                  {m.userId !== actorUserId && m.role !== "owner" ? (
                    <button
                      type="button"
                      className="text-sm text-red-600"
                      onClick={async () => {
                        if (!confirm("Hapus member ini?")) return;
                        const r = await removeMember({
                          merchantId,
                          targetUserId: m.userId,
                        });
                        if (r.ok) {
                          setMembers((prev) =>
                            prev.filter((p) => p.userId !== m.userId),
                          );
                        }
                      }}
                    >
                      Hapus
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Undang anggota baru</h2>
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setInviteResult(null);
            const r = await inviteMember({
              merchantId,
              email,
              role,
            });
            if (r.ok) {
              setInviteResult(`Invite dikirim ke ${email}. Dev URL: ${r.acceptUrl}`);
              setEmail("");
            } else {
              setInviteResult(`Gagal: ${r.reason}`);
            }
          }}
        >
          <input
            className="flex-1 rounded border px-3 py-2"
            placeholder="Email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select
            className="rounded border px-2 py-2"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {(["admin", "finance", "support"] as Role[]).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            Undang
          </button>
        </form>
        {inviteResult ? (
          <p className="break-all text-xs text-slate-600">{inviteResult}</p>
        ) : null}
      </section>
    </div>
  );
}
