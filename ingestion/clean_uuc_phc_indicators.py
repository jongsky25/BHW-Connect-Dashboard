"""Apply the agreed outlier rules to GIDA reconciled data, and log every action."""
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

REC = 'ingestion/data/GIDA reconciled data.xlsx'
OLD = 'ingestion/data/Submissions_UUA_2025_filled_1.xlsx'
OUT = '/tmp/claude-0/-home-user-BHW-Connect-Dashboard/54af3047-2e7b-5f6c-b6c4-165906a10f06/scratchpad/UUC_PHC_2025_cleaned.xlsx'

# barangay-level indicators the rules apply to (index in the Reconciled sheet -> label)
IND = {4: 'Physical Factor', 6: 'IP POP', 8: 'ARMED CONF', 9: 'IDP', 13: '4PS', 15: 'IMR',
       18: 'UFMR', 21: 'FIC', 24: 'ABR', 27: 'Pre-natal', 30: 'SBA', 33: 'Water'}

rec_wb = openpyxl.load_workbook(REC, read_only=True, data_only=True)
rec = rec_wb['Reconciled']
all_rows = list(rec.iter_rows(min_row=1, values_only=True))
HDR = list(all_rows[0])
rows = [list(r) for r in all_rows[1:] if any(c is not None for c in r)]

# ---- attach PSGC from the original 2025 LIST
old = openpyxl.load_workbook(OLD, read_only=True, data_only=True)['2025 LIST']
orows = [r for r in old.iter_rows(min_row=2, values_only=True)
         if r[0] and str(r[0]).strip() not in ('PROVINCE', 'TOTAL') and r[1] and r[3]]


def norm(x):
    return str(x).strip().upper() if x is not None else ''


by3, by2 = {}, {}
for r in orows:
    code = str(r[3]).strip().zfill(10)
    by3[(norm(r[0]), norm(r[1]), norm(r[2]))] = code
    by2.setdefault((norm(r[1]), norm(r[2])), []).append(code)

psgc_list, psgc_missing = [], 0
for r in rows:
    k3 = (norm(r[1]), norm(r[2]), norm(r[3]))
    code = by3.get(k3)
    if code is None:
        cands = by2.get((norm(r[2]), norm(r[3])), [])
        code = cands[0] if len(cands) == 1 else None
    if code is None:
        psgc_missing += 1
    psgc_list.append(code or '')

# ---- apply the rules
actions = []          # (row_idx, col_idx, label, original, action, new)
for ri, r in enumerate(rows):
    for ci, label in IND.items():
        v = r[ci]
        if not isinstance(v, (int, float)):
            continue
        if v < 0:
            actions.append((ri, ci, label, v, 'Negative set to 0', 0))
            r[ci] = 0
        elif v > 200:
            actions.append((ri, ci, label, v, 'Removed as outlier (over 200)', None))
            r[ci] = None
        elif v > 100:
            actions.append((ri, ci, label, v, 'Kept as encoded (101-200)', v))

n_neg = sum(1 for a in actions if a[4].startswith('Negative'))
n_keep = sum(1 for a in actions if a[4].startswith('Kept'))
n_rem = sum(1 for a in actions if a[4].startswith('Removed'))
touched = len({a[0] for a in actions})
removed_rows = len({a[0] for a in actions if a[4].startswith('Removed')})
print(f'rows={len(rows)} psgc_missing={psgc_missing} actions={len(actions)} '
      f'neg={n_neg} keep={n_keep} removed={n_rem} touched={touched} rows_with_removal={removed_rows}')

# ---------------------------------------------------------------- styling
A = 'Arial'
H_FILL = PatternFill('solid', fgColor='1F3864')
H_FONT = Font(name=A, size=10, bold=True, color='FFFFFF')
REM_FILL = PatternFill('solid', fgColor='FFC7CE')     # removed
KEEP_FILL = PatternFill('solid', fgColor='FFF2CC')    # kept 101-200
TITLE = Font(name=A, size=14, bold=True, color='1F3864')
BOLD = Font(name=A, size=10, bold=True)
BODY = Font(name=A, size=10)
ITAL = Font(name=A, size=9, italic=True)
THIN = Side(style='thin', color='BFBFBF')
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def head(ws, labels, row=1, height=34):
    for j, h in enumerate(labels, start=1):
        c = ws.cell(row=row, column=j, value=h)
        c.font = H_FONT
        c.fill = H_FILL
        c.alignment = Alignment(wrap_text=True, vertical='center', horizontal='center')
        c.border = BOX
    ws.row_dimensions[row].height = height


out = openpyxl.Workbook()

# ================================================================ README
s = out.active
s.title = 'README'
s.sheet_view.showGridLines = False
lines = [
    ('UUC for PHC 2025 — cleaned indicator dataset', 'title'),
    ('', None),
    ('Source', 'h'),
    ('GIDA reconciled data.xlsx, sheet "Reconciled" — 5,991 UUA barangays, 42 columns.', 'p'),
    ('PSGC codes were joined back from Submissions_UUA_2025_filled_1.xlsx, sheet "2025 LIST".', 'p'),
    ('', None),
    ('Rules applied, as instructed', 'h'),
    ('Applied to the 12 barangay-level indicator columns only.', 'p'),
    ('   1. Value below zero            ->  set to 0', 'p'),
    ('   2. Above 100 but not above 200 ->  kept exactly as encoded', 'p'),
    ('   3. Above 200                   ->  value removed, and flagged as removed', 'p'),
    ('', None),
    ('"Removed" means the single indicator value is blanked. The barangay stays in the dataset with', 'p'),
    ('its other indicators intact — no barangay was dropped. All 5,991 rows are present.', 'p'),
    ('', None),
    ('What the reconciliation already fixed', 'h'),
    ('Two things changed between the original workbook and the reconciled one, before these rules ran:', 'p'),
    ('   - Every negative value is gone. The original had 15 across four columns; the reconciled file', 'p'),
    ('     has a minimum of 0 in every indicator. Rule 1 therefore had nothing to act on.', 'p'),
    ('   - The FP CU column was dropped entirely. It was the worst offender in the original', 'p'),
    ('     (1,043 values above 100). It is not present in the reconciled file and is not in this one.', 'p'),
    ('', None),
    ('Not touched', 'h'),
    ('The "Prov Ref" columns are provincial reference values, not barangay measurements. Some legitimately', 'p'),
    ('exceed 100 (ABR Prov Ref reaches 277). The rules were NOT applied to them.', 'p'),
    ('The Pass/Fail assessment columns were carried over unchanged, and were computed by the source office', 'p'),
    ('against the ORIGINAL values — so a Pass/Fail beside a removed value still reflects that removed value.', 'p'),
    ('', None),
    ('Sheets', 'h'),
    ('"Cleaned data"  — all 5,991 barangays, rules applied. Removed cells are blank and shaded red;', 'p'),
    ('                  kept 101-200 values are shaded amber.', 'p'),
    ('"Actions log"   — one row per value acted on, with the original value and what was done to it.', 'p'),
    ('"Summary"       — counts per indicator, computed from the Actions log.', 'p'),
    ('', None),
    ('Counts as produced', 'h'),
]
r = 1
for text, kind in lines:
    c = s.cell(row=r, column=1, value=text)
    c.font = TITLE if kind == 'title' else (BOLD if kind == 'h' else BODY)
    r += 1

head(s, ['Indicator', 'Negatives set to 0', 'Kept (101-200)', 'Removed (over 200)', 'Total actions'], row=r, height=30)
r += 1
per = {}
for _, ci, label, _v, act, _n in actions:
    d = per.setdefault(label, [0, 0, 0])
    d[0 if act.startswith('Negative') else (1 if act.startswith('Kept') else 2)] += 1
for label in sorted(per, key=lambda k: -sum(per[k])):
    a_, b_, c_ = per[label]
    for j, v in enumerate([label, a_, b_, c_, a_ + b_ + c_], start=1):
        cc = s.cell(row=r, column=j, value=v)
        cc.font = BODY
        cc.border = BOX
        if j > 1:
            cc.number_format = '#,##0'
    r += 1
for j, v in enumerate(['Total', n_neg, n_keep, n_rem, len(actions)], start=1):
    cc = s.cell(row=r, column=j, value=v)
    cc.font = BOLD
    cc.border = BOX
    if j > 1:
        cc.number_format = '#,##0'
r += 2
for t in (f'{touched:,} of the {len(rows):,} barangays had at least one value acted on; '
          f'{removed_rows:,} had at least one value removed.',
          f'PSGC attached for {len(rows) - psgc_missing:,} of {len(rows):,} barangays. '
          f'{psgc_missing} could not be matched and are blank.',
          'These figures are fixed. The Summary tab recomputes them from the Actions log; if the two '
          'disagree, the formulas have not recalculated — reopen the file.'):
    s.cell(row=r, column=1, value=t).font = ITAL
    r += 1
for col, w in zip('ABCDE', (30, 18, 16, 18, 14)):
    s.column_dimensions[col].width = w

# ================================================================ Cleaned data
s2 = out.create_sheet('Cleaned data')
labels = ['PSGC'] + [str(h) for h in HDR] + ['Values removed', 'Values kept 101-200']
head(s2, labels, height=42)
IND_OUT = {ci + 2: lab for ci, lab in IND.items()}   # +1 for PSGC col, +1 for 1-based
act_by_cell = {(a[0], a[1]): a[4] for a in actions}
for ri, r in enumerate(rows):
    xl = ri + 2
    c = s2.cell(row=xl, column=1, value=psgc_list[ri])
    c.font, c.border, c.number_format = BODY, BOX, '@'
    for ci, v in enumerate(r):
        # openpyxl writes '' as an empty cell; the 7 HUC rows whose province is ''
        # therefore round-trip as blank, which renders identically in Excel.
        c = s2.cell(row=xl, column=ci + 2, value=v)
        c.font, c.border = BODY, BOX
        if isinstance(v, (int, float)):
            c.number_format = '#,##0.##'
        act = act_by_cell.get((ri, ci))
        if act and act.startswith('Removed'):
            c.fill = REM_FILL
        elif act and act.startswith('Kept'):
            c.fill = KEEP_FILL
    nrem = sum(1 for ci in IND if act_by_cell.get((ri, ci), '').startswith('Removed'))
    nkeep = sum(1 for ci in IND if act_by_cell.get((ri, ci), '').startswith('Kept'))
    for j, v in enumerate([nrem, nkeep], start=len(HDR) + 2):
        c = s2.cell(row=xl, column=j, value=v)
        c.font, c.border, c.number_format = BODY, BOX, '#,##0'
        if j == len(HDR) + 2 and v:
            c.fill = REM_FILL
s2.freeze_panes = 'E2'
s2.auto_filter.ref = f'A1:{get_column_letter(len(labels))}{len(rows) + 1}'
s2.column_dimensions['A'].width = 13
for k in range(len(HDR)):
    s2.column_dimensions[get_column_letter(2 + k)].width = 18 if k < 4 else 13
s2.column_dimensions[get_column_letter(len(HDR) + 2)].width = 11
s2.column_dimensions[get_column_letter(len(HDR) + 3)].width = 11

# ================================================================ Actions log
s3 = out.create_sheet('Actions log')
head(s3, ['#', 'Region', 'Province', 'City / Municipality', 'Barangay', 'PSGC', 'Indicator',
          'Original value', 'Action taken', 'Value after', 'Source row'], height=34)
ordered = sorted(actions, key=lambda a: (0 if a[4].startswith('Removed') else
                                         (1 if a[4].startswith('Negative') else 2), -a[3]))
for n, (ri, ci, label, orig, act, new) in enumerate(ordered, start=1):
    r = rows[ri]
    xl = n + 1
    vals = [n, r[0], r[1], r[2], r[3], psgc_list[ri], label, orig, act,
            ('(blank)' if new is None else new), ri + 2]
    for j, v in enumerate(vals, start=1):
        c = s3.cell(row=xl, column=j, value=v)
        c.font, c.border = BODY, BOX
        if j == 6:
            c.number_format = '@'
        if j == 8:
            c.number_format = '#,##0.##'
            c.font = BOLD
            c.fill = REM_FILL if act.startswith('Removed') else KEEP_FILL
s3.freeze_panes = 'A2'
s3.auto_filter.ref = f'A1:K{len(actions) + 1}'
for col, w in zip('ABCDEFGHIJK', (6, 40, 22, 26, 26, 13, 15, 14, 30, 12, 11)):
    s3.column_dimensions[col].width = w

# ================================================================ Summary
s4 = out.create_sheet('Summary')
s4.sheet_view.showGridLines = False
s4['A1'] = 'Actions taken, by indicator'
s4['A1'].font = TITLE
s4['A3'] = (f'{len(rows):,} barangays retained  |  {len(actions):,} values acted on  |  '
            f'{n_rem:,} removed  |  {n_keep:,} kept  |  {n_neg:,} negatives zeroed')
s4['A3'].font = ITAL
head(s4, ['Indicator', 'Negatives set to 0', 'Kept (101-200)', 'Removed (over 200)', 'Total actions'],
     row=5, height=30)
last = len(actions) + 1
order = sorted(per, key=lambda k: -sum(per[k]))
for k, label in enumerate(order):
    row = 6 + k
    s4.cell(row=row, column=1, value=label).font = BODY
    s4.cell(row=row, column=2, value=f"=COUNTIFS('Actions log'!$G$2:$G${last},$A{row},'Actions log'!$I$2:$I${last},\"Negative*\")")
    s4.cell(row=row, column=3, value=f"=COUNTIFS('Actions log'!$G$2:$G${last},$A{row},'Actions log'!$I$2:$I${last},\"Kept*\")")
    s4.cell(row=row, column=4, value=f"=COUNTIFS('Actions log'!$G$2:$G${last},$A{row},'Actions log'!$I$2:$I${last},\"Removed*\")")
    s4.cell(row=row, column=5, value=f"=SUM($B{row}:$D{row})")
    for j in range(1, 6):
        c = s4.cell(row=row, column=j)
        c.border = BOX
        if j > 1:
            c.font, c.number_format = BODY, '#,##0'
tot = 6 + len(order)
s4.cell(row=tot, column=1, value='Total').font = BOLD
for j, col in ((2, 'B'), (3, 'C'), (4, 'D'), (5, 'E')):
    c = s4.cell(row=tot, column=j, value=f'=SUM({col}6:{col}{tot - 1})')
    c.font, c.number_format, c.border = BOLD, '#,##0', BOX
s4.cell(row=tot, column=1).border = BOX
for t, off in ((f'Rule 1 (negatives) matched nothing: the reconciled file had already removed every '
                f'negative value.', 2),
               ('Removed values are blanked in "Cleaned data"; the barangay and its other indicators remain.', 3),
               ('Source: GIDA reconciled data.xlsx, sheet "Reconciled". Prov Ref and Pass/Fail columns untouched.', 4)):
    s4.cell(row=tot + off, column=1, value=t).font = ITAL
for col, w in zip('ABCDE', (30, 18, 16, 18, 14)):
    s4.column_dimensions[col].width = w

out.move_sheet('Summary', offset=-2)
out.save(OUT)
print('written:', OUT)
