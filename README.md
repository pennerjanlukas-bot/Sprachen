# Sprachen

Erlernen und Meistern verschiedener Sprachen und ihrer Strukturen – als Web-App fürs Handy/iPad (später auch PC).

## Module

| Modul | Inhalt | Status |
|---|---|---|
| **DLR-Test** | Synonyme, Phrasen, Redewendungen – Multiple Choice wie im Test | in Arbeit (Priorität) |
| weitere Sprachen | eigene Schwerpunkte | geplant |

## Lernprinzip

- **Spaced Repetition mit FSRS-5** (`js/fsrs.js`): jede Karte kommt kurz vor dem Vergessen wieder.
- **Prüfungsnah**: 5 Antwortmöglichkeiten; Ablenker werden so gewählt, dass sie der richtigen Antwort ähneln
  (gleiche Kategorie, Länge, Endung). Früher verwechselte Antworten tauchen gezielt wieder als Ablenker auf.
- **Bewertung automatisch**: falsch / „Nur geraten“ → kommt sofort wieder; richtig aber langsam → kürzeres Intervall.
- **Beide Richtungen**: Begriff → Bedeutung und Bedeutung → Begriff, schon in derselben Einheit. Eine Karte gilt erst als gelernt, wenn beide Richtungen sitzen.
- **Testdatum**: Intervalle werden gekappt, damit jede Karte vor dem Test noch einmal drankommt.
- **Prüfungssimulation** mit Zeitlimit und **Schwachstellen-Training**.
- **Endlos lernen** bis „Fertig“: fällige Karten zuerst, dann abwechselnd die am ehesten vergessenen und neue Karten.
- **Nochmal üben**: die heute gelernten Karten beliebig oft wiederholen. Richtige Antworten am selben Tag
  verlängern die Abstände nicht ein zweites Mal, Fehler fließen aber in die Planung ein.
- **5 Lager** (Kritisch, Unsicher, Solide, Sicher, Perfekt) nach Gedächtnisstabilität; jedes Lager lässt sich gezielt trainieren.
- **Statistik**: Antworten, Trefferquote und Lernzeit pro Tag, Verlauf der letzten 14 Tage.

## Starten

Statische Seite, kein Build nötig:

```sh
python3 -m http.server 8000
# http://localhost:8000
```

Auf dem iPhone/iPad: Seite in Safari öffnen → Teilen → „Zum Home-Bildschirm“. Dann läuft sie wie eine App,
auch offline. Der Fortschritt liegt lokal auf dem Gerät (Backup unter Einstellungen).

## Karten importieren

Kartendaten aus lizenzierten Kursunterlagen liegen **nicht** im Repository. Sie werden als Kartendatei
erzeugt und in der App unter *Einstellungen → Kartensätze* importiert; gespeichert werden sie nur auf dem Gerät.

```sh
pip install pdfplumber
python3 tools/convert_sp_pdf.py Synonyme_etc.pdf dlr-karten.json
```

Eine neue Version derselben Kartendatei ersetzt die alte; der Lernfortschritt bleibt erhalten, weil er an der
Karten-id hängt. Das Backup (*Einstellungen → Backup speichern*) enthält Fortschritt **und** Karten.

## Datenformat

Eine Kartendatei:

```json
{
  "type": "sprachtrainer-pack",
  "module": { "id": "dlr", "title": "DLR-Test Englisch", "subtitle": "…", "priority": true },
  "decks": [
    {
      "id": "dlr-synonyme",
      "title": "Synonyme",
      "category": "synonym",
      "prompt": "Welches Wort hat die gleiche Bedeutung?",
      "cards": [
        {
          "term": "reluctant",
          "answer": "unwilling",
          "alt": ["hesitant"],
          "distractors": ["eager", "willing"],
          "example": "She was reluctant to admit her mistake.",
          "note": "Deutsch: widerwillig"
        }
      ]
    }
  ]
}
```

- `category`: `synonym`, `phrase`, `idiom`, `proverb` oder `word`
- `alt`: weitere richtige Bedeutungen (werden nie als falsche Antwort angezeigt)
- `distractors` (optional): falsche Antworten aus den Unterlagen; fehlen sie, wählt die App ähnliche Antworten anderer Karten
- `id` (optional): wird sonst aus `term` gebildet – der Lernfortschritt hängt an der id

Fest eingebaute (frei verwendbare) Kartensätze können zusätzlich in `data/index.json` unter `decks` eingetragen werden.
