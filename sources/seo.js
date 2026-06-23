// AI SEO / answer-engine support for Gender Útikalauz.
// Generates robots.txt, sitemap.xml, llms.txt, llms-full.txt and server-rendered
// article HTML with full <head> meta + JSON-LD (Article/MedicalWebPage, FAQPage,
// BreadcrumbList). Crawlers get real content and structured data without running JS.

const fs = require('fs');
const path = require('path');

// Public base URL where these crawlable pages are served (override per environment).
const SITE_URL = (process.env.SITE_URL || 'https://genderutikalauz.hu').replace(/\/+$/, '');
// Human-facing interactive single-page app (hash-routed).
const APP_URL = (process.env.APP_URL || 'https://genderutikalauz.hu').replace(/\/+$/, '');
const SITE_NAME = 'Gender Útikalauz';
const AUTHOR_NAME = 'Montefiori Adéna Auróra';
const DEFAULT_LANG = 'hu';

// AI crawler user-agents we explicitly welcome and want to measure.
const AI_BOTS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-Web',
  'PerplexityBot', 'Google-Extended', 'CCBot', 'Bytespider', 'Amazonbot',
  'Applebot-Extended', 'cohere-ai', 'Diffbot', 'ImagesiftBot', 'Omgilibot',
];

// Referrer hostnames that indicate a click from an AI assistant answer.
const AI_REFERRERS = [
  'chatgpt.com', 'chat.openai.com', 'perplexity.ai', 'gemini.google.com',
  'copilot.microsoft.com', 'bing.com/chat', 'claude.ai', 'you.com',
];

function contentDir(lang) {
  return path.join(__dirname, 'public', lang || DEFAULT_LANG);
}

function htmlEscape(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function jsonLdEscape(str) {
  // Safe to embed inside a <script type="application/ld+json"> block.
  return String(str == null ? '' : str).replace(/</g, '\\u003c');
}

// List article slugs for a language (skip config files prefixed with "_").
function listSlugs(lang) {
  const dir = contentDir(lang);
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch (e) {
    return [];
  }
  return files
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .map((f) => f.replace(/\.md$/, ''))
    .sort();
}

// Minimal frontmatter line parser (key: "value") for the simple house format.
function parseFrontmatter(raw) {
  const meta = {};
  raw.split('\n').forEach((line) => {
    const idx = line.indexOf(':');
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    if (!key || key.startsWith('#')) return;
    let value = line.slice(idx + 1).trim();
    value = value.replace(/^['"]+|['"]+$/g, '');
    meta[key] = value;
  });
  return meta;
}

// Strip the navigation status emojis used in titles (✅ 😐 ⛔) and trim.
function cleanTitle(title) {
  return String(title || '').replace(/^[\s✅😐⛔➡️]+/u, '').trim();
}

// Pull the first H1 ("# ...") from the markdown body, ignoring HTML lines.
function firstHeading(body) {
  const m = body.match(/^\s{0,3}#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : '';
}

// Extract GYIK question/answer pairs: "### Question" under a "## GYIK..." heading,
// each answer being the plain text until the next "###" or "##".
function extractFaq(body) {
  const faqStart = body.search(/^##\s+GYIK/im);
  if (faqStart === -1) return [];
  let section = body.slice(faqStart);
  // Stop the FAQ section at the next H2 that is not the GYIK heading itself.
  const after = section.replace(/^##\s+GYIK[^\n]*\n/i, '');
  const nextH2 = after.search(/^##\s+/m);
  const faqBody = nextH2 === -1 ? after : after.slice(0, nextH2);

  const faqs = [];
  // Split into "### question\n answer" chunks.
  const chunks = faqBody.split(/^###\s+/m).slice(1);
  chunks.forEach((chunk) => {
    const nl = chunk.indexOf('\n');
    const question = (nl === -1 ? chunk : chunk.slice(0, nl)).trim();
    const answer = stripMarkup(nl === -1 ? '' : chunk.slice(nl + 1)).replace(/\s+/g, ' ').trim();
    if (question && answer) faqs.push({ question, answer });
  });
  return faqs;
}

// Remove markdown/HTML markup, leaving readable plain text.
function stripMarkup(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]/g, '')
    .replace(/„|"|"/g, '"')
    .trim();
}

function fileMtimeISO(lang, slug) {
  try {
    return fs.statSync(path.join(contentDir(lang), `${slug}.md`)).mtime.toISOString();
  } catch (e) {
    return new Date().toISOString();
  }
}

// Read and parse a single entry into a structured object.
function readEntry(lang, slug) {
  const file = path.join(contentDir(lang), `${slug}.md`);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch (e) {
    return null;
  }
  const parts = raw.split('---');
  const hasFrontmatter = parts.length >= 3 && parts[0].trim() === '';
  const meta = hasFrontmatter ? parseFrontmatter(parts[1]) : {};
  const body = hasFrontmatter ? parts.slice(2).join('---') : raw;

  const title = cleanTitle(meta.title) || firstHeading(body) || slug;
  const description = (meta.description || '').replace(/^['"]+|['"]+$/g, '').trim();
  const dateModified = meta.dateModified || fileMtimeISO(lang, slug);
  const datePublished = meta.datePublished || dateModified;

  return {
    slug,
    lang: lang || DEFAULT_LANG,
    title,
    description,
    keywords: meta.keywords || '',
    image: meta.image || '',
    datePublished,
    dateModified,
    body,
    faqs: extractFaq(body),
    canonical: `${SITE_URL}/cikk/${slug}`,
    appUrl: `${APP_URL}/#/entry?id=${slug}`,
  };
}

function summarize(text, max) {
  const clean = stripMarkup(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

// ---- robots.txt ----------------------------------------------------------

function buildRobots() {
  const lines = [
    '# Gender Útikalauz - robots.txt',
    'User-agent: *',
    'Allow: /',
    '',
  ];
  AI_BOTS.forEach((bot) => {
    lines.push(`User-agent: ${bot}`);
    lines.push('Allow: /');
    lines.push('');
  });
  lines.push(`Sitemap: ${SITE_URL}/sitemap.xml`);
  lines.push('');
  return lines.join('\n');
}

// ---- sitemap.xml ---------------------------------------------------------

function buildSitemap(lang) {
  const slugs = listSlugs(lang);
  const urls = slugs.map((slug) => {
    const lastmod = fileMtimeISO(lang, slug).slice(0, 10);
    return [
      '  <url>',
      `    <loc>${htmlEscape(`${SITE_URL}/cikk/${slug}`)}</loc>`,
      `    <lastmod>${lastmod}</lastmod>`,
      '    <changefreq>monthly</changefreq>',
      '    <priority>0.8</priority>',
      '  </url>',
    ].join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `  <url><loc>${SITE_URL}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
    urls.join('\n'),
    '</urlset>',
    '',
  ].join('\n');
}

// ---- llms.txt / llms-full.txt -------------------------------------------

function buildLlms(lang) {
  const slugs = listSlugs(lang);
  const lines = [
    `# ${SITE_NAME}`,
    '',
    '> Magyar nyelvű, megbízható forrásokra épülő tudástár transznemű és nem-bináris',
    '> emberek számára: hormonterápia, műtétek, feminizálás, maszkulinizálás, jogi és',
    '> társadalmi kérdések, valamint a szövetségeseknek szóló útmutatók.',
    '',
    '## Cikkek',
    '',
  ];
  slugs.forEach((slug) => {
    const e = readEntry(lang, slug);
    if (!e) return;
    const desc = e.description ? `: ${e.description}` : '';
    lines.push(`- [${e.title}](${SITE_URL}/cikk/${slug})${desc}`);
  });
  lines.push('');
  return lines.join('\n');
}

function buildLlmsFull(lang) {
  const slugs = listSlugs(lang);
  const blocks = [
    `# ${SITE_NAME} - teljes tartalom`,
    '',
    'Ez a fájl az összes cikk rövid kivonatát tartalmazza AI-rendszerek számára.',
    '',
  ];
  slugs.forEach((slug) => {
    const e = readEntry(lang, slug);
    if (!e) return;
    blocks.push(`## ${e.title}`);
    blocks.push(`URL: ${SITE_URL}/cikk/${slug}`);
    if (e.description) blocks.push(`Leírás: ${e.description}`);
    blocks.push('');
    blocks.push(summarize(e.body, 900));
    blocks.push('');
  });
  return blocks.join('\n');
}

// ---- JSON-LD -------------------------------------------------------------

function buildJsonLd(entry) {
  const publisher = {
    '@type': 'Organization',
    name: SITE_NAME,
    url: APP_URL,
    logo: { '@type': 'ImageObject', url: `${APP_URL}/favicon.ico` },
  };

  const article = {
    '@context': 'https://schema.org',
    '@type': 'MedicalWebPage',
    headline: entry.title,
    name: entry.title,
    description: entry.description,
    inLanguage: entry.lang,
    datePublished: entry.datePublished,
    dateModified: entry.dateModified,
    url: entry.canonical,
    mainEntityOfPage: { '@type': 'WebPage', '@id': entry.canonical },
    author: { '@type': 'Person', name: AUTHOR_NAME },
    publisher,
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: APP_URL },
  };
  if (entry.keywords) article.keywords = entry.keywords;
  if (entry.image) article.image = entry.image;

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: SITE_NAME, item: APP_URL },
      { '@type': 'ListItem', position: 2, name: entry.title, item: entry.canonical },
    ],
  };

  const graphs = [article, breadcrumb];

  if (entry.faqs && entry.faqs.length) {
    graphs.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: entry.faqs.map((f) => ({
        '@type': 'Question',
        name: f.question,
        acceptedAnswer: { '@type': 'Answer', text: f.answer },
      })),
    });
  }

  return graphs
    .map((g) => `<script type="application/ld+json">${jsonLdEscape(JSON.stringify(g))}</script>`)
    .join('\n');
}

// ---- Server-rendered article HTML ---------------------------------------

async function renderArticleHtml(entry) {
  let bodyHtml = '';
  try {
    const { marked } = await import('marked');
    bodyHtml = marked.parse(entry.body);
  } catch (e) {
    bodyHtml = `<pre>${htmlEscape(entry.body)}</pre>`;
  }

  const title = htmlEscape(entry.title);
  const desc = htmlEscape(entry.description);
  const fullTitle = `${title} | ${SITE_NAME}`;

  return `<!doctype html>
<html lang="${htmlEscape(entry.lang)}">
<head>
<meta charset="utf-8">
<title>${fullTitle}</title>
<meta name="description" content="${desc}">
${entry.keywords ? `<meta name="keywords" content="${htmlEscape(entry.keywords)}">\n` : ''}<meta name="author" content="${htmlEscape(AUTHOR_NAME)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${htmlEscape(entry.canonical)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${htmlEscape(SITE_NAME)}">
<meta property="og:locale" content="hu_HU">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${htmlEscape(entry.canonical)}">
${entry.image ? `<meta property="og:image" content="${htmlEscape(entry.image)}">\n` : ''}<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta property="article:published_time" content="${htmlEscape(entry.datePublished)}">
<meta property="article:modified_time" content="${htmlEscape(entry.dateModified)}">
${buildJsonLd(entry)}
</head>
<body>
<main>
<p><a href="${htmlEscape(entry.appUrl)}">Interaktív változat megnyitása a Gender Útikalauzon</a></p>
${bodyHtml}
</main>
</body>
</html>
`;
}

module.exports = {
  SITE_URL,
  APP_URL,
  AI_BOTS,
  AI_REFERRERS,
  listSlugs,
  readEntry,
  buildRobots,
  buildSitemap,
  buildLlms,
  buildLlmsFull,
  renderArticleHtml,
};
