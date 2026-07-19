import { GeoSearch } from "@/components/home/geo-search";

export default function PlaceNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">We couldn&apos;t find that place</h1>
      <p className="text-muted">
        The place code in that link doesn&apos;t match anything in the dataset. Try searching for
        it instead.
      </p>
      <GeoSearch />
    </div>
  );
}
