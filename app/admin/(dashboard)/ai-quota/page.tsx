import { listAiProviderQuota } from "@/lib/db/admin";

export default async function AdminAiQuotaPage() {
  const rows = await listAiProviderQuota();
  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">AI provider quota</h2>
      {rows.length === 0 ? (
        <p className="text-muted">No quota windows recorded yet — no AI calls have been made.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="pb-2 pr-4">Provider</th>
                <th className="pb-2 pr-4">Window</th>
                <th className="pb-2 pr-4">Used / limit</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="py-2 pr-4">{row.provider}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {row.windowType} · {new Date(row.windowStart).toLocaleString()}
                  </td>
                  <td className="py-2 pr-4">
                    {row.requestCount} / {row.limitValue}
                  </td>
                  <td className="py-2">
                    {row.isPaused && row.pausedUntil && new Date(row.pausedUntil) > now
                      ? `Paused until ${new Date(row.pausedUntil).toLocaleTimeString()}`
                      : "Active"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
