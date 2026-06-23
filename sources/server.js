const express = require('express');
const path = require('path');
const fs = require('fs');
const marked = import('marked');
const cors = require('cors');
const seo = require('./seo');

const app = express();
const port = process.env.PORT || 3000;

// Allow CORS connections from http://localhost:4200
// const corsOptions = {
//   origin: 'http://localhost:4200',
// };
app.use(cors());

// Measure AI crawler hits and AI-assistant referrals (#8).
// Logs are captured by the hosting platform; no persistence required.
app.use((req, res, next) => {
  const ua = req.get('user-agent') || '';
  const referer = req.get('referer') || '';
  const bot = seo.AI_BOTS.find((b) => ua.toLowerCase().includes(b.toLowerCase()));
  if (bot) {
    console.log(`[ai-crawler] bot=${bot} path=${req.originalUrl} ts=${new Date().toISOString()}`);
  }
  const refHost = seo.AI_REFERRERS.find((h) => referer.toLowerCase().includes(h));
  if (refHost) {
    console.log(`[ai-referral] source=${refHost} path=${req.originalUrl} ts=${new Date().toISOString()}`);
  }
  next();
});

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// API routes
// Serve static files from the 'images' directory
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));

// ---- AI SEO: robots, sitemap, llms.txt, server-rendered articles ----
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(seo.buildRobots());
});

app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml').send(seo.buildSitemap('hu'));
});

app.get('/llms.txt', (req, res) => {
  res.type('text/plain; charset=utf-8').send(seo.buildLlms('hu'));
});

app.get('/llms-full.txt', (req, res) => {
  res.type('text/plain; charset=utf-8').send(seo.buildLlmsFull('hu'));
});

// Crawlable, server-rendered article pages with full <head> meta + JSON-LD.
app.get('/cikk/:slug', async (req, res) => {
  const slug = String(req.params.slug || '').replace(/[^a-z0-9\-]/gi, '');
  const lang = req.query.languageCode || 'hu';
  const entry = seo.readEntry(lang, slug);
  if (!entry) {
    return res.status(404).type('text/plain').send('A keresett cikk nem található.');
  }
  try {
    const html = await seo.renderArticleHtml(entry);
    res.type('text/html; charset=utf-8').send(html);
  } catch (e) {
    res.status(500).type('text/plain').send('Hiba a cikk megjelenítésekor.');
  }
});

app.get('/translations', (req, res) => {
  const { languageCode } = req.query;
  const filePath = path.join(__dirname, 'public', languageCode, '_translations.json');

  try {
    const translations = require(filePath);
    res.status(200).json(translations);
  } catch (error) {
    res.status(404).json({ error: 'Translations not found.' });
  }
});

app.get('/galery', (req, res) => {
  const { languageCode } = req.query;
  const filePath = path.join(__dirname, 'public', languageCode, '_galery.json');

  try {
    const galery = require(filePath);
    res.status(200).json(galery);
  } catch (error) {
    res.status(404).json({ error: 'Galery not found.' });
  }
});

app.get('/categories', (req, res) => {
  const { languageCode } = req.query;
  const filePath = path.join(__dirname, 'public', languageCode, '_sidebar.json');

  try {
    const sidebarContent = require(filePath);
    res.status(200).json(sidebarContent);
  } catch (error) {
    res.status(404).json({ error: 'Sidebar content not found.' });
  }
});

app.get('/entry', (req, res) => {
  const { id, languageCode, extension } = req.query;
  let ext = extension || 'md';
  const filePath = path.join(__dirname, 'public', languageCode, `${id}.${ext}`);

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    res.status(200).send(content);
  } catch (error) {
    res.status(404).json({ error: 'Entry ' + id + ' (lang:' + languageCode + ') not found.' });
  }
});

app.get('/search', (req, res) => {
  const { query, languageCode } = req.query;
  const searchResults = [];
  const maxResults = 5;

  const removeAccents = (str) => {
    return str.normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/-/g, ' ');
  };

  const files = fs.readdirSync(path.join(__dirname, 'public', languageCode));
  let count = 0;

  files.forEach((file) => {
    if (file.endsWith('.md') && count < maxResults) {
      const filePath = path.join(__dirname, 'public', languageCode, file);
      const pureContent = fs.readFileSync(filePath, 'utf-8');
      const content = marked
        .parse(pureContent)
        .replace(/<[^>]*>/g, '')
        .replace(/&quot;/g, '"');


      const normalizedContent = removeAccents(content.toLowerCase());
      const normalizedQuery = removeAccents(query.toLowerCase());

      if (normalizedContent.includes(normalizedQuery)) {
        // Parse the Markdown content to extract the title
        const tokens = marked.lexer(pureContent);
        let title = '';
        for (const token of tokens) {
          if (token.type === 'heading' && token.depth === 1) {
            title = token.text;
            break;
          }
        }

        if (removeAccents(title.toLowerCase()).includes(normalizedQuery)) {
          searchResults.push({
            fileName: file.replace('.md', ''),
            title: title,
            contextBefore: '',
            match: '',
            contextAfter: '',
            mustInclude: true
          });

          return;
        }

        const matchStartIndex = normalizedContent.indexOf(normalizedQuery);
        const matchEndIndex = matchStartIndex + normalizedQuery.length;
        const contextBefore = content.substring(Math.max(0, matchStartIndex - 50), matchStartIndex);
        const contextAfter = content.substring(matchEndIndex, matchEndIndex + 50);

        searchResults.push({
          fileName: file.replace('.md', ''),
          title: title,
          contextBefore: contextBefore,
          match: content.substring(matchStartIndex, matchEndIndex),
          contextAfter: contextAfter,
          mustInclude: false
        });
      }
    }

    //return count >= maxResults; // Return true to exit the loop when the limit is reached
  });

  var resultSet =
    searchResults.filter(q => q.mustInclude)
      .concat(searchResults.filter(q => !q.mustInclude))
      .slice(0, maxResults);


  res.status(200).json(resultSet);
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
