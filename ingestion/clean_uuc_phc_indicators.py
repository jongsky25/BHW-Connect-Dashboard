"""Apply the agreed indicator rules to GIDA reconciled data, and log every action.

Rules (set by the programme owner, superseding the earlier cap/remove rules):

  Coverage percentages   Water, Pre-natal, SBA   capped at 100 - a share of a
                                                 population cannot exceed 100%.
  Immunisation coverage  FIC                     left exactly as encoded, including
                                                 values above 100.
  Rates per 1,000        IMR, UFMR, ABR          left exactly as encoded; a rate is
                                                 not bounded by 100.
  Any indicator          value below zero        set to 0.

No value is removed and no barangay is dropped. All 5,991 rows survive with every
indicator present.

Usage:
    python ingestion/clean_uuc_phc_indicators.py \
        --src "ingestion/data/GIDA reconciled data.xlsx" \
        --psgc-src ingestion/data/Submissions_UUA_2025_filled_1.xlsx \
        --out UUC_PHC_2025_cleaned.xlsx
"""
import argparse

import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

# Column index in the "Reconciled" sheet -> (label, treatment)
CAP_AT_100 = {33: 'Water', 27: 'Pre-natal', 30: 'SBA'}
AS_ENCODED = {21: 'FIC', 15: 'IMR', 18: 'UFMR', 24: 'ABR'}
ALREADY_BOUNDED = {4: 'Physical Factor', 6: 'IP POP', 8: 'ARMED CONF', 9: 'IDP', 13: '4PS'}
INDICATORS = {**CAP_AT_100, **AS_ENCODED, **ALREADY_BOUNDED}

CAP_ACTION = 'Capped at 100'
NEG_ACTION = 'Negative set to 0'


def norm(x):
    return str(x).strip().upper() if x is not None else ''


def load_psgc(path):
    """Map (province, citymun, barangay) -> PSGC from the original 2025 LIST."""
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True)['2025 LIST']
    by3, by2 = {}, {}
    for r in ws.iter_rows(min_row=2, values_only=True):
        if not (r[0] and str(r[0]).strip() not in ('PROVINCE', 'TOTAL') and r[1] and r[3]):
            continue
        code = str(r[3]).strip().zfill(10)
        by3[(norm(r[0]), norm(r[1]), norm(r[2]))] = code
        by2.setdefault((norm(r[1]), norm(r[2])), []).append(code)
    return by3, by2


def apply_rules(rows):
    """Mutate rows in place; return the list of actions taken."""
    actions = []
    for ri, r in enumerate(rows):
        for ci, label in INDICATORS.items():
            v = r[ci]
            if not isinstance(v, (int, float)):
                continue
            if v < 0:
                actions.append((ri, ci, label, v, NEG_ACTION, 0))
                r[ci] = 0
            elif ci in CAP_AT_100 and v > 100:
                actions.append((ri, ci, label, v, CAP_ACTION, 100))
                r[ci] = 100
    return actions


# ---------------------------------------------------------------- styling
A = 'Arial'
H_FILL = PatternFill('solid', fgColor='1F3864')
H_FONT = Font(name=A, size=10, bold=True, color='FFFFFF')
CAP_FILL = PatternFill('solid', fgColor='FFF2CC')     # value changed by a rule
ASIS_FILL = PatternFill('solid', fgColor='DDEBF7')    # above 100, deliberately kept
TITLE = Font(name=A, size=14, bold=True, color='1F3864')
BOLD = Font(name=A, size=10, bold=True)
BODY = Font(name=A, size=10)
ITAL = Font(name=A, size=9, italic=True)
THIN = Side(style='thin', color='BFBFBF')
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def head(ws, labels, row=1, height=34):
    for j, h in enumerate(labels, start=1):
        c = ws.cell(row=row, column=j, value=h)
        c.font, c.fill, c.border = H_FONT, H_FILL, BOX
        c.alignment = Alignment(wrap_text=True, vertical='center', horizontal='center')
    ws.row_dimensions[row].height = height


def build(src, psgc_src, out_path):
    rec = openpyxl.load_workbook(src, read_only=True, data_only=True)['Reconciled']
    all_rows = list(rec.iter_rows(min_row=1, values_only=True))
    HDR = list(all_rows[0])
    rows = [list(r) for r in all_rows[1:] if any(c is not None for c in r)]

    by3, by2 = load_psgc(psgc_src)
    psgc_list, psgc_missing = [], 0
    for r in rows:
        code = by3.get((norm(r[1]), norm(r[2]), norm(r[3])))
        if code is None:
            cands = by2.get((norm(r[2]), norm(r[3])), [])
            code = cands[0] if len(cands) == 1 else None
        if code is None:
            psgc_missing += 1
        psgc_list.append(code or '')

    # snapshot the above-100 values we deliberately keep, before capping
    kept_as_is = [(ri, ci, AS_ENCODED[ci], r[ci])
                  for ri, r in enumerate(rows) for ci in AS_ENCODED
                  if isinstance(r[ci], (int, float)) and r[ci] > 100]

    actions = apply_rules(rows)
    n_cap = sum(1 for a in actions if a[4] == CAP_ACTION)
    n_neg = sum(1 for a in actions if a[4] == NEG_ACTION)
    touched = len({a[0] for a in actions})
    print(f'rows={len(rows)} psgc_missing={psgc_missing} capped={n_cap} negatives={n_neg} '
          f'kept_above_100={len(kept_as_is)} barangays_touched={touched}')

    out = openpyxl.Workbook()

    # ============================================================ README
    s = out.active
    s.title = 'README'
    s.sheet_view.showGridLines = False
    lines = [
        ('UUC for PHC 2025 — cleaned indicator dataset', 'title'),
        ('', None),
        ('Source', 'h'),
        ('GIDA reconciled data.xlsx, sheet "Reconciled" — 5,991 UUA barangays, 42 columns.', 'p'),
        ('PSGC codes joined from Submissions_UUA_2025_filled_1.xlsx, sheet "2025 LIST".', 'p'),
        ('', None),
        ('Rules applied', 'h'),
        ('The treatment depends on what the indicator measures.', 'p'),
        ('', None),
        ('  Water, Pre-natal, SBA    capped at 100. These are coverage percentages — the share of', 'p'),
        ('                           households or mothers reached — and a share cannot exceed 100%.', 'p'),
        ('  FIC                      left exactly as encoded, including values above 100.', 'p'),
        ('  IMR, UFMR, ABR           left exactly as encoded. These are rates per 1,000, not', 'p'),
        ('                           percentages, so they are not bounded by 100.', 'p'),
        ('  Any indicator below 0    set to 0.', 'p'),
        ('', None),
        ('Nothing is removed and no barangay is dropped. All 5,991 rows are present with every', 'p'),
        ('indicator populated.', 'p'),
        ('', None),
        ('What the reconciliation had already fixed', 'h'),
        ('  - Every negative value was already gone, so the below-zero rule matched nothing.', 'p'),
        ('  - The FP CU column was dropped from the reconciled file entirely. The cleaned dataset', 'p'),
        ('    therefore carries 12 indicators, not the original 13.', 'p'),
        ('', None),
        ('Not touched', 'h'),
        ('The "Prov Ref" columns are provincial reference values, not barangay measurements, and some', 'p'),
        ('legitimately exceed 100. The Pass/Fail and High/Low columns were computed by the source', 'p'),
        ('office against the ORIGINAL values, so where a value was capped its assessment still', 'p'),
        ('reflects the uncapped number. Both were carried over unchanged.', 'p'),
        ('', None),
        ('Reading the colours in "Cleaned data"', 'h'),
        ('  Amber  — value changed by a rule (capped at 100).', 'p'),
        ('  Blue   — value above 100 that was deliberately kept, because the indicator is a rate', 'p'),
        ('           or an unbounded coverage figure.', 'p'),
        ('', None),
        ('Counts as produced', 'h'),
    ]
    r = 1
    for text, kind in lines:
        c = s.cell(row=r, column=1, value=text)
        c.font = TITLE if kind == 'title' else (BOLD if kind == 'h' else BODY)
        r += 1

    head(s, ['Indicator', 'Treatment', 'Values above 100', 'Capped to 100', 'Left as encoded'],
         row=r, height=30)
    r += 1
    summary_rows = []
    for ci, label in list(CAP_AT_100.items()) + list(AS_ENCODED.items()):
        above = sum(1 for _ri, _ci, _l, v in kept_as_is if _ci == ci) if ci in AS_ENCODED else \
            sum(1 for a in actions if a[1] == ci and a[4] == CAP_ACTION)
        capped = above if ci in CAP_AT_100 else 0
        asis = 0 if ci in CAP_AT_100 else above
        summary_rows.append((label, 'Capped at 100' if ci in CAP_AT_100 else 'As encoded',
                             above, capped, asis))
    for label, treat, above, capped, asis in sorted(summary_rows, key=lambda x: -x[2]):
        for j, v in enumerate([label, treat, above, capped, asis], start=1):
            c = s.cell(row=r, column=j, value=v)
            c.font, c.border = BODY, BOX
            if j > 2:
                c.number_format = '#,##0'
        r += 1
    for j, v in enumerate(['Total', '', n_cap + len(kept_as_is), n_cap, len(kept_as_is)], start=1):
        c = s.cell(row=r, column=j, value=v)
        c.font, c.border = BOLD, BOX
        if j > 2:
            c.number_format = '#,##0'
    r += 2
    for t in (f'{touched:,} of the {len(rows):,} barangays had at least one value changed.',
              f'{len(kept_as_is):,} values above 100 were retained unchanged by design.',
              f'PSGC attached for {len(rows) - psgc_missing:,} of {len(rows):,} barangays; '
              f'{psgc_missing} unmatched.',
              'These figures are fixed. The Summary tab recomputes them from the Actions log.'):
        s.cell(row=r, column=1, value=t).font = ITAL
        r += 1
    for col, w in zip('ABCDE', (30, 18, 18, 16, 16)):
        s.column_dimensions[col].width = w

    # ============================================================ Cleaned data
    s2 = out.create_sheet('Cleaned data')
    labels = ['PSGC'] + [str(h) for h in HDR] + ['Values capped', 'Above 100 kept']
    head(s2, labels, height=42)
    act_by_cell = {(a[0], a[1]): a[4] for a in actions}
    keep_cells = {(k[0], k[1]) for k in kept_as_is}
    for ri, r in enumerate(rows):
        xl = ri + 2
        c = s2.cell(row=xl, column=1, value=psgc_list[ri])
        c.font, c.border, c.number_format = BODY, BOX, '@'
        for ci, v in enumerate(r):
            c = s2.cell(row=xl, column=ci + 2, value=v)
            c.font, c.border = BODY, BOX
            if isinstance(v, (int, float)):
                c.number_format = '#,##0.##'
            if (ri, ci) in act_by_cell:
                c.fill = CAP_FILL
            elif (ri, ci) in keep_cells:
                c.fill = ASIS_FILL
        ncap = sum(1 for ci in INDICATORS if (ri, ci) in act_by_cell)
        nkeep = sum(1 for ci in AS_ENCODED if (ri, ci) in keep_cells)
        for j, v in enumerate([ncap, nkeep], start=len(HDR) + 2):
            c = s2.cell(row=xl, column=j, value=v)
            c.font, c.border, c.number_format = BODY, BOX, '#,##0'
    s2.freeze_panes = 'E2'
    s2.auto_filter.ref = f'A1:{get_column_letter(len(labels))}{len(rows) + 1}'
    s2.column_dimensions['A'].width = 13
    for k in range(len(HDR)):
        s2.column_dimensions[get_column_letter(2 + k)].width = 18 if k < 4 else 13
    s2.column_dimensions[get_column_letter(len(HDR) + 2)].width = 11
    s2.column_dimensions[get_column_letter(len(HDR) + 3)].width = 11

    # ============================================================ Actions log
    s3 = out.create_sheet('Actions log')
    head(s3, ['#', 'Region', 'Province', 'City / Municipality', 'Barangay', 'PSGC', 'Indicator',
              'Original value', 'Action taken', 'Value after', 'Source row'], height=34)
    ordered = sorted(actions, key=lambda a: -a[3])
    for n, (ri, ci, label, orig, act, new) in enumerate(ordered, start=1):
        r = rows[ri]
        for j, v in enumerate([n, r[0], r[1], r[2], r[3], psgc_list[ri], label, orig, act, new,
                               ri + 2], start=1):
            c = s3.cell(row=n + 1, column=j, value=v)
            c.font, c.border = BODY, BOX
            if j == 6:
                c.number_format = '@'
            if j == 8:
                c.number_format, c.font, c.fill = '#,##0.##', BOLD, CAP_FILL
    s3.freeze_panes = 'A2'
    s3.auto_filter.ref = f'A1:K{len(actions) + 1}'
    for col, w in zip('ABCDEFGHIJK', (6, 40, 22, 26, 26, 13, 15, 14, 22, 12, 11)):
        s3.column_dimensions[col].width = w

    # ============================================================ Above 100 kept
    s5 = out.create_sheet('Above 100 kept')
    head(s5, ['#', 'Region', 'Province', 'City / Municipality', 'Barangay', 'PSGC', 'Indicator',
              'Value', 'Why kept', 'Source row'], height=34)
    why = {'FIC': 'Immunisation coverage — can exceed 100 when the eligible-infant denominator is low',
           'IMR': 'Rate per 1,000 — not bounded by 100',
           'UFMR': 'Rate per 1,000 — not bounded by 100',
           'ABR': 'Rate per 1,000 — not bounded by 100'}
    for n, (ri, ci, label, v) in enumerate(sorted(kept_as_is, key=lambda k: -k[3]), start=1):
        r = rows[ri]
        for j, val in enumerate([n, r[0], r[1], r[2], r[3], psgc_list[ri], label, v,
                                 why[label], ri + 2], start=1):
            c = s5.cell(row=n + 1, column=j, value=val)
            c.font, c.border = BODY, BOX
            if j == 6:
                c.number_format = '@'
            if j == 8:
                c.number_format, c.font, c.fill = '#,##0.##', BOLD, ASIS_FILL
    s5.freeze_panes = 'A2'
    s5.auto_filter.ref = f'A1:J{len(kept_as_is) + 1}'
    for col, w in zip('ABCDEFGHIJ', (6, 40, 22, 26, 26, 13, 15, 12, 62, 11)):
        s5.column_dimensions[col].width = w

    # ============================================================ Summary
    s4 = out.create_sheet('Summary')
    s4.sheet_view.showGridLines = False
    s4['A1'] = 'Actions taken, by indicator'
    s4['A1'].font = TITLE
    s4['A3'] = (f'{len(rows):,} barangays retained  |  {n_cap:,} values capped at 100  |  '
                f'{n_neg:,} negatives zeroed  |  {len(kept_as_is):,} above-100 values kept  |  '
                f'0 values removed')
    s4['A3'].font = ITAL
    head(s4, ['Indicator', 'Treatment', 'Capped to 100', 'Above 100 kept'], row=5, height=30)
    last_a, last_k = len(actions) + 1, len(kept_as_is) + 1
    order = sorted(summary_rows, key=lambda x: -x[2])
    for k, (label, treat, _above, _c, _a) in enumerate(order):
        row = 6 + k
        s4.cell(row=row, column=1, value=label).font = BODY
        s4.cell(row=row, column=2, value=treat).font = BODY
        s4.cell(row=row, column=3,
                value=f"=COUNTIFS('Actions log'!$G$2:$G${last_a},$A{row})")
        s4.cell(row=row, column=4,
                value=f"=COUNTIFS('Above 100 kept'!$G$2:$G${last_k},$A{row})")
        for j in range(1, 5):
            c = s4.cell(row=row, column=j)
            c.border = BOX
            if j > 2:
                c.font, c.number_format = BODY, '#,##0'
    tot = 6 + len(order)
    s4.cell(row=tot, column=1, value='Total').font = BOLD
    for j, col in ((3, 'C'), (4, 'D')):
        c = s4.cell(row=tot, column=j, value=f'=SUM({col}6:{col}{tot - 1})')
        c.font, c.number_format, c.border = BOLD, '#,##0', BOX
    for j in (1, 2):
        s4.cell(row=tot, column=j).border = BOX
    for t, off in (('Water, Pre-natal and SBA are coverage percentages, so they are capped at 100.', 2),
                   ('FIC, IMR, UFMR and ABR are left as encoded — a rate is not bounded by 100.', 3),
                   ('No value was removed; all 5,991 barangays keep every indicator.', 4),
                   ('Source: GIDA reconciled data.xlsx. Prov Ref and Pass/Fail columns untouched.', 5)):
        s4.cell(row=tot + off, column=1, value=t).font = ITAL
    for col, w in zip('ABCD', (30, 18, 16, 16)):
        s4.column_dimensions[col].width = w

    out.move_sheet('Summary', offset=-3)
    out.save(out_path)
    print('written:', out_path)
    return {'rows': len(rows), 'capped': n_cap, 'negatives': n_neg,
            'kept_above_100': len(kept_as_is), 'touched': touched, 'psgc_missing': psgc_missing}


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--src', default='ingestion/data/GIDA reconciled data.xlsx')
    ap.add_argument('--psgc-src', default='ingestion/data/Submissions_UUA_2025_filled_1.xlsx')
    ap.add_argument('--out', default='UUC_PHC_2025_cleaned.xlsx')
    args = ap.parse_args()
    build(args.src, args.psgc_src, args.out)
