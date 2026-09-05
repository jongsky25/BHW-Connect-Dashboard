import type { DistrictCorrectionAction } from "@/lib/db/district-corrections";

/**
 * How a district correction is described in one line, in the one place both surfaces read it from:
 * D2.4's admin queue and D2.5's public ledger. The ledger is the public mirror of the queue — a
 * reader checking what happened to their proposal should see the same sentence the reviewer acted
 * on, not a second paraphrase that could drift away from it.
 *
 * A structural type rather than the row types themselves, because the two surfaces project
 * different column sets (the ledger deliberately omits `submitter_email` and `reviewed_by`) and
 * this needs neither.
 */
export type CorrectionChange = {
  action: DistrictCorrectionAction;
  districtCode: string | null;
  districtName: string | null;
  toDistrictCode: string | null;
  toDistrictName: string | null;
  geoCode: string | null;
  geoName: string | null;
};

export const CORRECTION_ACTION_LABEL: Record<DistrictCorrectionAction, string> = {
  add: "Add a place",
  remove: "Remove a place",
  move: "Move a place",
  rename: "Rename district",
  other: "Something else",
};

/** What this proposal, if accepted, would change — read before the rationale, the way a diff's
 *  header is read before its body. */
export function describeCorrectionChange(row: CorrectionChange): string {
  const place = row.geoName ?? row.geoCode ?? "(place not specified)";
  const district = row.districtName ?? row.districtCode ?? "(district not specified)";
  const toDistrict = row.toDistrictName ?? row.toDistrictCode ?? "(destination not specified)";
  switch (row.action) {
    case "add":
      return `Add ${place} to ${district}`;
    case "remove":
      return `Remove ${place} from ${district}`;
    case "move":
      return `Move ${place} from ${district} to ${toDistrict}`;
    case "rename":
      return `Rename ${district}`;
    case "other":
      return `Something else about ${district}`;
  }
}

/**
 * What an *accepted* correction did to the mapping, in the mapping's own terms. The ledger needs
 * this alongside the proposal text because two of the five actions leave no `geo_district_map` row
 * to link to: a `remove` marks the existing row rejected (public reads drop it by policy) and a
 * `rename` edits `dim_legislative_district` instead. Saying so is what keeps "accepted" from
 * reading as "accepted, and nothing visibly happened".
 */
export function describeAcceptedOutcome(action: DistrictCorrectionAction): string {
  switch (action) {
    case "add":
      return "A new membership row was written, shown below.";
    case "move":
      return "A new membership row was written in the destination district; the old row was superseded, not deleted, and still shows in the origin district's correction history.";
    case "remove":
      return "The membership row was withdrawn from the mapping. Withdrawn rows are not published, so there is no row to link to here.";
    case "rename":
      return "The district's name was corrected. A rename changes the district record itself, not a membership row.";
    case "other":
      return "No automatic change was applied. The review note is the record of what, if anything, was done by hand.";
  }
}
