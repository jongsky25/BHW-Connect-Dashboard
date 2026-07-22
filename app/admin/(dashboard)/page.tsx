import Link from "next/link";
import { listFeedback, listAiProviderQuota } from "@/lib/db/admin";
import { getAskCacheSavings } from "@/lib/db/ask-bank";

export default async function AdminOverviewPage() {
  const [openFeedback, quota, savings] = await Promise.all([
    listFeedback("open"),
    listAiProviderQuota(),
    getAskCacheSavings(),
  ]);
  const now = new Date();
  const pausedProviders = new Set(
    quota.filter((q) => q.isPaused && q.pausedUntil && new Date(q.pausedUntil) > now).map((q) => q.provider),
  );
  const totalChat = savings.liveMessages + savings.cacheHits;
  const hitRate = totalChat > 0 ? Math.round((savings.cacheHits / totalChat) * 100) : 0;

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
      <div className="rounded-lg border border-border p-4">
        <p className="text-sm text-muted">Chat answers from cache — 30d</p>
        <p className="mt-1 text-2xl font-semibold">
          {savings.cacheHits.toLocaleString()}
          <span className="ml-1 text-sm font-normal text-muted">({hitRate}% hit rate)</span>
        </p>
        <Link href="/admin/answer-bank" className="mt-2 inline-block text-sm underline hover:text-accent">
          Answer bank
        </Link>
      </div>
    </div>
  );
}
