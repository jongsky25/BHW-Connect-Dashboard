import { FeedbackForm } from "@/components/feedback/feedback-form";

export const metadata = { title: "Feedback" };

export default function FeedbackPage() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Feedback</h1>
        <p className="mt-2 text-muted">
          Found a bug, have a question about the data, or want to suggest something? Let us know.
        </p>
      </div>
      <FeedbackForm />
    </div>
  );
}
