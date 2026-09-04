import Link from "next/link";

export default function DistrictNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">We couldn&apos;t find that district</h1>
      <p className="text-muted">
        The district code in that link doesn&apos;t match anything in the dataset, or it belongs to
        a mapping this build withdrew.
      </p>
      <Link href="/districts" className="underline hover:text-accent">
        Browse all districts
      </Link>
    </div>
  );
}
