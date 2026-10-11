"""Extract JIF quartiles from the UEFISCDI June 2026 public PDF. No AIS/SJR substitution."""
import hashlib
import json
import re
import sys
from pathlib import Path
from pypdf import PdfReader

SOURCE = 'https://uefiscdi.gov.ro/resource-832709-JCR-2025.iunie-2026.site.pdf'
pdf = Path(sys.argv[1])
dest = Path(sys.argv[2])
pattern = re.compile(r'(.+?)\s+(\d{4}-\d{3}[\dX]|N/A)\s+(\d{4}-\d{3}[\dX]|N/A)\s+(.+?)\s+(SCIE|SSCI|ESCI|AHCI)\s+(Q[1-4]|N/A)\s+(Q[1-4]|N/A)$')
journals = {}
unparsed = []
rows = 0
for page_no, page in enumerate(PdfReader(pdf).pages, 1):
    text = page.extract_text()
    if 'Journal name ISSN eISSN Category Edition JIF Quartile AIS Quartile' not in text:
        raise ValueError(f'Missing table header on page {page_no}')
    body = text.split('Journal name ISSN eISSN Category Edition JIF Quartile AIS Quartile', 1)[1]
    body = re.sub(r'\d+ (?:of|din) \d+\s*$', '', body).strip()
    buffer = ''
    for line in body.splitlines():
        buffer = (buffer + ' ' + line.strip()).strip()
        m = pattern.fullmatch(buffer)
        if not m:
            continue
        name, issn, eissn, category, edition, jif, _ais = m.groups()
        key = (name, issn, eissn)
        j = journals.setdefault(key, {'name': name, 'issn': [s for s in (issn, eissn) if s != 'N/A'], 'categories': []})
        item = {'name': category, 'quartile': jif if jif != 'N/A' else None}
        if item not in j['categories']:
            j['categories'].append(item)
        rows += 1
        buffer = ''
    if buffer:
        unparsed.append({'page': page_no, 'text': buffer})
if unparsed:
    Path(str(dest)+'.unparsed.json').write_bytes(json.dumps(unparsed, ensure_ascii=False, indent=2).encode())
    raise ValueError(f'{len(unparsed)} unparsed page fragments: review before publishing')
if rows < 20000 or len(journals) < 15000:
    raise ValueError('Unexpectedly incomplete source extraction')
data = {'year': 2025, 'release': '2026-06', 'source': SOURCE, 'source_sha256': hashlib.sha256(pdf.read_bytes()).hexdigest(), 'rows': rows, 'journals': list(journals.values())}
dest.write_bytes(('/* Public UEFISCDI JIF quartiles: data year 2025, release June 2026. */\nwindow.LITDB_JCR_DATA='+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n').encode())
print(json.dumps({'rows': rows, 'journals': len(journals), 'bytes': dest.stat().st_size}))
