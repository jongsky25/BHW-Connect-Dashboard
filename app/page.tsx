export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-32 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">BHW Connect</h1>
      <p className="max-w-md text-muted">
        The public dashboard is under construction. See{" "}
        <code className="font-mono text-sm">docs/BUILD_PLAN.md</code> for the roadmap.
      </p>
    </div>
  );
}
