# Table to Markdown Converter — specification

**Tagline:** Paste a table from Excel, Sheets or CSV and get a clean Markdown table in your browser, nothing sent anywhere.

**Category:** Data & Files

**Free alternative to:** TablesGenerator and Table Convert (Excel to Markdown tools with ad-heavy pages, clunky editors, and pasted data processed on remote or third-party scripts)

**Search phrases:** table to markdown, excel to markdown table, csv to markdown, html table to markdown, markdown table generator, google sheets to markdown

**Allowed libraries:** papaparse

**Published at:** https://turhe123.github.io/table-to-markdown-local/

## Acceptance checks (each must have a test)

- pasting tab separated sample text produces a Markdown table with a separator row
- pasting CSV with quoted commas keeps those commas inside one cell
- choosing right alignment for the Price column writes a colon at the right of its separator
- pipe characters inside cells are escaped in the output
- the Copy button places the Markdown on the clipboard and shows a confirmation
- works at 390px wide

## Spec

Search demand: table to markdown, excel to markdown table and csv to markdown are everyday searches by developers, technical writers and people writing README files, wiki pages and GitHub issues. Popular generators are cluttered with ads, ask for edits in a cramped grid editor, and some process pasted text on remote servers. Writing aligned pipes by hand is the pain point that makes people search.

Our version does one job: convert tabular text into a tidy Markdown table. Input: paste from a spreadsheet (tab separated), CSV, TSV, or an HTML table pasted from a web page also drop a CSV file. Features: auto detect the format, header row toggle, per column alignment (left, center, right, or auto where numeric columns go right), pretty padding so pipes line up in plain text, a compact mode without padding, escaping of pipe characters and line breaks inside cells turned into a break tag, and an option to produce GitHub flavoured output or plain output. A reverse mode accepts a Markdown table and outputs CSV, so the page covers the round trip.

UI: two panes that stack on narrow screens. Top or left: a large input textarea with a placeholder explaining you can paste straight from Excel or Sheets, and a Load sample link. Bottom or right: a monospace output box and a rendered preview table beneath it. An options strip holds format auto detect, header toggle, padding toggle and a row of alignment buttons under each preview column header. Primary buttons are Copy Markdown and Download .md file, named table.md. Empty state shows the sample link. Error state points out unbalanced quotes. Keyboard: the shortcut Control or Command plus Enter copies the result, and all controls are reachable in tab order.

Technical approach: listen for the paste event and read both text/plain and text/html from the clipboard data when HTML contains a table element, walk its rows and cells through DOMParser (never inserting it into the live page) and take text content. For text, use the allowed papaparse library with delimiter guessing and quote handling. Compute column widths using the count of code points, with a width table for East Asian wide characters so padding looks right. Generate the Markdown string, update the preview by building table elements with textContent so pasted content can never inject markup. Downloads use a Blob and an object URL copying uses the Clipboard API with a textarea selection fallback for older Safari. All work is synchronous and fast for tables up to a few thousand rows show a note above 5,000 rows.

Edge cases: ragged rows are padded with empty cells merged cells from HTML are repeated emoji and combining characters count by code point cells containing backslashes or asterisks are optionally escaped leading and trailing whitespace is trimmed with a toggle empty header cells get a placeholder carriage return line endings are normalised.

Demo data: a fictional table of five coffee drinks at a made up cafe called Tidepool Roasters with columns Drink, Size ml, Price and Notes, one note containing a pipe character and one price with a comma decimal.
