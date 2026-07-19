import Link from "next/link";
import { listFeedback, listAiProviderQuota } from "@/lib/db/admin";

export default async function AdminOverviewPage() {
  const [openFeedback, quota] = await Promise.all([listFeedback("open"), listAiProviderQuota()]);
  const now = new Date();
  const pausedProviders = new Set(
    quota.filter((q) => q.isPaused && q.pausedUntil && new Date(q.pausedUntil) > now).map((q) => q.provider),
  );

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="rounded-lg border border-border p-4">
        <p className="text-sm text-muted">Open feedback</p>
        <p className="mt-1 text-2xl font-semibold">{openFeedback.length}</p>
        <Link href="/admin/feedback" className="mt-2 inline-block text-sm underline hover:text-accent">
          Review
        </Link>
      </div>
      <div className="rounded-lg border border-border p-4">
        <p className="text-sm text-muted">Paused AI providers</p>
        <p className="mt-1 text-2xl font-semibold">{pausedProviders.size}</p>
        <Link href="/admin/ai-quota" className="mt-2 inline-block text-sm underline hover:text-accent">
          View quota
        </Link>
      </div>
    </div>
  );
}
