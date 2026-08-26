# UUC for PHC 2025 — indicator cleaning report

What was done to the indicator values, why, and what it leaves open. Companion to
`UUC_PHC_2025_PLAN.md` §5, which recorded the problem this resolves.

**Input:** `ingestion/data/GIDA reconciled data.xlsx`, sheet `Reconciled` — 5,991 UUA barangays × 42
columns, supplied by the source office as the reconciled replacement for the original
`2025 LIST`.
**Output:** `UUC_PHC_2025_cleaned.xlsx` — same 5,991 barangays, rules applied, every action logged.

---

## 1. What the reconciliation already fixed

Two of the problems in `UUC_PHC_2025_PLAN.md` §5 were resolved before any rule ran here. Both
change what the plan says, so both are recorded rather than quietly absorbed.

**Every negative value is gone.** The original carried 15 values below zero across four columns
(UFMR −2, ABR −2, SBA −1, Water −1). The reconciled file has a minimum of 0 in every indicator.
The no-data-sentinel hypothesis in §5 is therefore moot for this dataset — but note it was
resolved by *replacement*, and the file does not say whether those cells became a true zero or a
corrected measurement. If the distinction matters for a rate, it is still worth asking.

**The FP CU column was dropped entirely.** It was the single worst column in the original —
1,043 values above 100, 17.4% of all barangays. It is absent from the reconciled file, so the
cleaned dataset carries **12 indicators, not 13**. Any downstream work that expected Family
Planning Current Users must be told; this is a schema change, not a data correction.

## 2. Rules applied

As instructed, to the 12 barangay-level indicator columns only:

| Condition | Action |
|---|---|
| Value below zero | Set to 0 |
| Above 100, not above 200 | Kept exactly as encoded |
| Above 200 | Value removed and flagged as removed |

**"Removed" blanks one indicator value, not the barangay.** The barangay stays with its other
indicators intact. All 5,991 rows are present in the output — no row was dropped.

**Not touched:** the `* Prov Ref` columns are provincial reference values rather than barangay
measurements, and some legitimately exceed 100 (`ABR Prov Ref` reaches 277). Applying the rules
to them would have corrupted the benchmarks. The `Pass or Fail` / `High or Low*` assessment
columns were also carried over unchanged — see §5.

## 3. What happened

| Indicator | Negatives → 0 | Kept (101–200) | Removed (>200) | Total |
|---|---:|---:|---:|---:|
| Water | 0 | 635 | 251 | 886 |
| FIC | 0 | 407 | 49 | 456 |
| Pre-natal | 0 | 141 | 67 | 208 |
| ABR | 0 | 77 | 23 | 100 |
| UFMR | 0 | 52 | 28 | 80 |
| IMR | 0 | 42 | 18 | 60 |
| SBA | 0 | 29 | 1 | 30 |
| **Total** | **0** | **1,383** | **437** | **1,820** |

The five percentage columns — Physical Factor, IP POP, ARMED CONF, IDP, 4PS — were already
within 0–100 and needed no action.

- **1,523** of 5,991 barangays had at least one value acted on (25.4%).
- **399** had at least one value removed (6.7%).
- **437** values removed out of 71,892 indicator cells — **0.6%**.
- Rule 1 matched nothing, because §1 had already removed every negative.

## 4. Verification

Checked by re-reading the output against the source, cell by cell:

- 5,991 rows in, 5,991 rows out.
- Every value over 200 is blank in the output; every value 101–200 is byte-identical to the
  source; every value within 0–100 is unchanged. **Zero rule violations.**
- No cell outside the 12 indicator columns differs from the source.
- The actions log holds exactly 1,820 rows, matching the transformations applied, and each row's
  original value is consistent with the action recorded against it.
- PSGC codes joined from the original `2025 LIST` on province/citymun/barangay, with a
  citymun+barangay fallback for the 7 Zamboanga City HUC rows whose province field is blank.
  **5,990 of 5,991 matched.**

The one unmatched row is `SORSOGON / PILAR / SAN ANTONIO`, still unresolved for the reason given
in `UUC_PHC_2025_PLAN.md` §4: PSGC carries two identically named barangays in that municipality
and nothing in either file separates them.

## 5. What this does not fix

**The units question is still open.** These rules are a containment measure, not an answer. A
Water value of 150 is still not interpretable as a percentage; it was kept because it falls in
the band you chose to keep, not because it has been validated. The 1,383 kept values are exactly
as uncertain as they were — they are simply now bounded. `UUC_PHC_2025_PLAN.md` §7 question 1
stands, and U3 remains blocked on it.

**The Pass/Fail columns are now inconsistent with the data beside them.** The source office
computed `High or Low`, `High or Low2` … against the *original* values. Where a value was removed,
its assessment still reflects the removed number. Either recompute those columns downstream or
treat them as source-office output that is not derivable from the cleaned values — do not present
both as if they agree.

**`dataentry_comment` is unreliable as a flag.** It marks 1,895 rows "With values above 100", but
381 of those have no value above 100, and 9 rows marked "Recheck entry" do. Everything in this
report was computed from the values themselves, not from that column.

**57 rows have `#N/A` reference values**, so their Pass/Fail assessments are `#N/A` too. Untouched
here; they will need a decision before the assessments are rendered anywhere.

## 6. Effect on the build

`UUC_PHC_2025_PLAN.md` U1 is unaffected — it ships the classification, and the classification is
unchanged at 5,991 UUA barangays.

U3 becomes viable for the **five clean percentage columns** plus the seven cleaned ones *if* the
units question is settled. Until then the cleaned file is a better input than the original, not a
publishable one.

---

*Generated from `GIDA reconciled data.xlsx`. Every figure in §3 was recomputed from the source
file rather than carried over from the earlier outlier extract.*
