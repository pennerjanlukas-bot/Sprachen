"""Wandelt die S&P-Vorbereitungs-PDF (Synonyms / Sprichwörter / Phrases) in eine Kartendatei um,
die in der App unter Einstellungen → Kartensätze importiert wird.

Aufruf: python3 tools/convert_sp_pdf.py <datei.pdf> <kartendatei.json>
Benötigt: pdfplumber
"""
import json
import re
import sys

import pdfplumber

LETTER = re.compile(r'^[A-Z]$')


def clean(s):
    # Zeilenumbruch zwischen zwei Varianten („to emphasise“ / „to emphasize“) als Alternative behandeln.
    lines = [l.strip() for l in (s or '').split('\n') if l.strip()]
    if len(lines) > 1 and all(l.startswith('to ') for l in lines):
        s = ' / '.join(lines)
    s = re.sub(r'\s+', ' ', s or '').strip()
    s = re.sub(r'(\w)\(', r'\1 (', s)
    s = re.sub(r'\(\s+', '(', s)
    s = re.sub(r'\s+\)', ')', s)
    return s.replace(' ,', ',').replace('´', "'").replace('’', "'")


def split_top(s, sep=','):
    """Trennt an Kommas, aber nicht innerhalb von Klammern."""
    parts, depth, cur = [], 0, ''
    for ch in s:
        depth += ch == '('
        depth -= ch == ')'
        if ch == sep and depth == 0:
            parts.append(cur.strip())
            cur = ''
        else:
            cur += ch
    parts.append(cur.strip())
    return [p for p in parts if p]


def rows(path):
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            # Nur der Fließtext (Calibri); Wasserzeichen und Kopf-/Fußzeilen fallen weg.
            text = page.filter(lambda o: o.get('object_type') != 'char'
                               or ('Calibri' in o['fontname'] and o['size'] < 12.5))
            for table in text.find_tables():
                for r in table.extract():
                    cells = [clean(c) for c in r if clean(c)]
                    if cells:
                        yield cells


def is_single_word(term):
    return len(re.sub(r'^to ', '', re.sub(r'\(.*?\)', '', term)).split()) == 1


def convert(path):
    synonyms, phrases, proverbs = {}, {}, {}
    section = None
    for cells in rows(path):
        if len(cells) == 1:
            if LETTER.match(cells[0]):
                section = 'words'
            elif cells[0] == 'Sprichwörter':
                section = 'proverbs'
            elif cells[0].startswith('Collection of special expressions'):
                section = None  # Seite ohne Lösungen
            continue
        if section is None:
            continue
        term = cells[0]
        if section == 'proverbs':
            first, *others = [g.strip() for g in re.split(r'\s+oder:\s*', cells[-1]) if g.strip()]
            card = proverbs.setdefault(term.lower(), {'term': term, 'answer': first})
            for g in [first, *others]:
                if g != card['answer'] and g not in card.get('alt', []):
                    card.setdefault('alt', []).append(g)
            continue

        meaning = cells[1]
        german = cells[2] if len(cells) > 2 else ''
        single = is_single_word(term)
        target = synonyms if single else phrases
        if single and ';' not in meaning:
            parts = split_top(meaning)
            card = {'term': term, 'answer': parts[0]}
            if parts[1:]:
                card['alt'] = parts[1:]
        else:
            card = {'term': term, 'answer': meaning}
        if german:
            card['note'] = f'Deutsch: {german}'
        key = term.lower()
        if key in target:
            prev = target[key]
            extra = [card['answer'], *card.get('alt', [])]
            prev['alt'] = [a for a in dict.fromkeys(prev.get('alt', []) + extra) if a != prev['answer']]
            if german and german not in prev.get('note', ''):
                prev['note'] = (prev.get('note', 'Deutsch:') + f', {german}')
        else:
            target[key] = card
    return synonyms, phrases, proverbs


def main(pdf_path, out_path):
    synonyms, phrases, proverbs = convert(pdf_path)
    decks = [
        ('synonyme', 'Synonyme', 'synonym', 'Welches Wort hat die gleiche Bedeutung?', synonyms),
        ('phrasen', 'Phrasen & Redewendungen', 'phrase', 'Was bedeutet dieser Ausdruck?', phrases),
        ('sprichwoerter', 'Sprichwörter', 'proverb', 'Welches deutsche Sprichwort entspricht?', proverbs),
    ]
    pack = {
        'type': 'sprachtrainer-pack',
        'module': {'id': 'dlr', 'title': 'DLR-Test Englisch', 'subtitle': 'Synonyme, Phrasen & Sprichwörter',
                   'priority': True},
        'decks': [{'id': f'dlr-{deck_id}', 'title': title, 'category': category, 'prompt': prompt,
                   'source': 'S&P Training, Englisch v. 3.2', 'cards': list(cards.values())}
                  for deck_id, title, category, prompt, cards in decks],
    }
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(pack, f, ensure_ascii=False, separators=(',', ':'))
    for deck in pack['decks']:
        print(f"{deck['title']}: {len(deck['cards'])} Karten")


if __name__ == '__main__':
    main(*sys.argv[1:3])
