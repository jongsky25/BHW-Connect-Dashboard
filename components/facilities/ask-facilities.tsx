import { ChatLauncher } from "@/components/chat/chat-launcher";
import type { GeoLevel } from "@/lib/filters/schema";

/**
 * The section's "Ask the data" launcher, on `components/uuc-phc/ask-the-list.tsx`'s precedent —
 * a thin wrapper rather than two call sites repeating the same props, so the starter questions and
 * placeholder say the same thing on every page of the section.
 *
 * **The starter questions are chosen for what they teach, not only for what they answer.** The
 * first two are the counts and coverage figure the pages already render. The third is the trap a
 * visitor is most likely to walk into unprompted — treating a blank licensing_status as
 * "unlicensed" — and it is here deliberately, so the chat's rule 2 answer is the first thing a
 * visitor sees rather than something they have to stumble into by asking.
 */
const FACILITIES_STARTER_QUESTIONS = [
  "How many health facilities are here, and what types?",
  "How many barangays here have at least one facility?",
  "Are the facilities with no licensing status unlicensed?",
];

export function AskFacilities({
  geoCode,
  geoLevel,
  geoName,
}: {
  geoCode?: string;
  geoLevel?: GeoLevel;
  geoName?: string;
}) {
  return (
    <ChatLauncher
      dataset="facilities"
      geoCode={geoCode}
      geoLevel={geoLevel}
      geoName={geoName}
      starterQuestions={FACILITIES_STARTER_QUESTIONS}
      introLine="Ask a question about the DOH National Health Facility Registry."
      inputPlaceholder="Ask about facility counts, types, ownership, or coverage…"
      methodologyHref="/facilities/methodology#ask"
    />
  );
}
