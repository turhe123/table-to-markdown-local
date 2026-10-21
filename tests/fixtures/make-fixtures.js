// Generates the small fictional fixtures used by smoke.spec.js and window.__demo.
// Run with: node tests/fixtures/make-fixtures.js
const fs = require('fs');
const path = require('path');
const out = (name, text) => fs.writeFileSync(path.join(__dirname, name), text);

// Five drinks at the made-up Tidepool Roasters cafe. One note has a pipe, one price a comma decimal.
const drinks = [
  ['Drink', 'Size ml', 'Price', 'Notes'],
  ['Flat White', '180', '4.20', 'Double ristretto, silky milk'],
  ['Cortado', '120', '3,80', 'Equal parts espresso | milk'],
  ['Tidepool Cold Brew', '350', '5.10', 'Steeped 18 hours'],
  ['Oat Cappuccino', '240', '4.60', 'Oat milk, cocoa dust'],
  ['Sea Salt Mocha', '300', '5.40', 'Seasonal special'],
];
out('tidepool.tsv', drinks.map((r) => r.join('\t')).join('\r\n') + '\r\n');

// CSV with quoted commas and an escaped quote.
out('tidepool-quoted.csv', [
  'Drink,Size ml,Price,Notes',
  'Flat White,180,4.20,"Double ristretto, silky milk"',
  '"Cortado, iced",120,3.80,"Equal parts, ""half and half"""',
  'Oat Cappuccino,240,4.60,"Oat milk, cocoa dust, cinnamon"',
].join('\n') + '\n');

// CSV with an unbalanced quote.
out('broken-quotes.csv', [
  'Drink,Size ml,Price,Notes',
  'Flat White,180,4.20,"Double ristretto, silky milk',
  'Cortado,120,3.80,Equal parts',
].join('\n') + '\n');

// Markdown table for the reverse (Markdown to CSV) mode.
out('tidepool-table.md', [
  '| Drink          | Size ml | Price | Notes                        |',
  '| :------------- | ------: | ----: | ---------------------------- |',
  '| Flat White     |     180 |  4.20 | Double ristretto, silky milk |',
  '| Cortado        |     120 |  3,80 | Equal parts espresso \\| milk |',
  '| Sea Salt Mocha |     300 |  5.40 | Seasonal<br>special          |',
].join('\n') + '\n');
