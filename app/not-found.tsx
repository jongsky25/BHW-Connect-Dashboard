import Link from "next/link";
import { GeoSearch } from "@/components/home/geo-search";

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-muted">
        That page doesn&apos;t exist. Try finding a place instead, or head back home.
      </p>
      <GeoSearch />
      <Link href="/" className="text-sm underline hover:text-accent">
        Back to home
      </Link>
    </div>
  );
}
