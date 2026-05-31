export default async function OverviewPage({
  params,
}: {
  params: Promise<{ merchantSlug: string }>;
}) {
  const { merchantSlug } = await params;
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">Overview</h1>
      <p className="text-slate-600">Merchant: {merchantSlug}</p>
      <p className="text-slate-500">Katalog dan order belum aktif (Plan 4).</p>
    </div>
  );
}
