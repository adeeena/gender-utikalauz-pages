#!/usr/bin/env node
/**
 * Em-dash (—, U+2014) és en-dash (–, U+2013) ellenőrző és javító szkript.
 *
 * Használat:
 *   node scripts/check-dashes.js            # ellenőrzés (hibát jelez, ha talál)
 *   node scripts/check-dashes.js --fix      # automatikus javítás
 *   node scripts/check-dashes.js file1 ...  # csak a megadott fájlok vizsgálata
 *
 * Csere szabályok javításkor:
 *   " — " / " – "  ->  "; "        (tagmondat-elválasztó)
 *   "szám–szám"     ->  "szám-szám" (számtartomány)
 *   minden további — ->  ";"
 *   minden további – ->  "-"
 */

'use strict';

const fs = require('fs');
const path = require('path');

const EM_DASH = '\u2014';
const EN_DASH = '\u2013';
const DASH_REGEX = new RegExp(`[${EM_DASH}${EN_DASH}]`);

const fix = process.argv.includes('--fix');
const explicitFiles = process.argv.slice(2).filter((a) => a !== '--fix');

// Ezek a fájlok dokumentációs céllal tartalmazhatják a tiltott karaktereket.
const ALLOWLIST = new Set(['copilot-instructions.md']);

/** Rekurzívan összegyűjti a .md fájlokat egy könyvtárból. */
function collectMarkdown(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      collectMarkdown(full, acc);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      acc.push(full);
    }
  }
  return acc;
}

function resolveTargets() {
  let files;
  if (explicitFiles.length > 0) {
    files = explicitFiles.filter((f) => fs.existsSync(f));
  } else {
    const root = process.cwd();
    const contentDir = path.join(root, 'sources', 'public');
    files = [];
    if (fs.existsSync(contentDir)) collectMarkdown(contentDir, files);
  }
  return files.filter((f) => !ALLOWLIST.has(path.basename(f)));
}

/**
 * Pontosabb csere: számtartományok kötőjellel, egyéb dash-ek pontosvesszővel.
 */
function transform(text) {
  let out = text;
  // 1) Számtartomány: szám (sp?) dash (sp?) szám -> szám-szám
  out = out.replace(
    new RegExp(`(\\d) *[${EM_DASH}${EN_DASH}] *(\\d)`, 'g'),
    '$1-$2'
  );
  // 2) Tagmondat-elválasztó szóközökkel: " — " -> "; "
  out = out.replace(new RegExp(` +[${EM_DASH}${EN_DASH}] +`, 'g'), '; ');
  // 3) Maradék em-dash -> ; , maradék en-dash -> -
  out = out.replace(new RegExp(EM_DASH, 'g'), ';');
  out = out.replace(new RegExp(EN_DASH, 'g'), '-');
  return out;
}

const targets = resolveTargets();
let offenders = 0;
let fixedFiles = 0;

for (const file of targets) {
  const content = fs.readFileSync(file, 'utf8');
  if (!DASH_REGEX.test(content)) continue;

  if (fix) {
    const updated = transform(content);
    if (updated !== content) {
      fs.writeFileSync(file, updated, 'utf8');
      fixedFiles++;
      console.log(`javítva: ${file}`);
    }
  } else {
    const lines = content.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (DASH_REGEX.test(line)) {
        offenders++;
        console.error(`${file}:${i + 1}: tiltott gondolatjel (— vagy –)`);
      }
    });
  }
}

if (fix) {
  console.log(fixedFiles === 0 ? 'Nincs javítandó gondolatjel.' : `${fixedFiles} fájl javítva.`);
  process.exit(0);
}

if (offenders > 0) {
  console.error('');
  console.error(`Hiba: ${offenders} tiltott gondolatjel (em-dash/en-dash) található.`);
  console.error('Javítás: node scripts/check-dashes.js --fix');
  process.exit(1);
}

console.log('OK: nincs tiltott gondolatjel.');
process.exit(0);
