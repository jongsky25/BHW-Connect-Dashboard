import { getTopVisitedGeos, getUsageEventCounts } from "@/lib/db/usage-analytics";

export default async function AdminUsagePage() {
  const [eventCounts, topVisited] = await Promise.all([getUsageEventCounts(30), getTopVisitedGeos(20, 30)]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Usage — last 30 days</h2>
        {eventCounts.length === 0 ? (
          <p className="mt-2 text-muted">No usage events recorded yet.</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <tbody>
              {eventCounts.map((row) => (
                <tr key={row.eventType} className="border-t border-border">
                  <td className="py-1 pr-4">{row.eventType}</td>
                  <td className="py-1 text-right font-medium">{row.count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold">Most-visited places</h2>
        {topVisited.length === 0 ? (
          <p className="mt-2 text-muted">No geo-tagged visits recorded yet.</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <tbody>
              {topVisited.map((row) => (
                <tr key={row.geoCode} className="border-t border-border">
                  <td className="py-1 pr-4">{row.geoCode}</td>
                  <td className="py-1 text-right font-medium">{row.visits.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
