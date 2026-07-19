import "server-only";
import { createSupabaseServerClient } from "./supabase";

export type ChangelogEntry = { id: number; publishedAt: string; title: string; bodyMd: string };

export async function getChangelogEntries(): Promise<ChangelogEntry[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("changelog_entries")
    .select("id, published_at, title, body_md")
    .order("published_at", { ascending: false });

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    publishedAt: row.published_at,
    title: row.title,
    bodyMd: row.body_md,
  }));
}
