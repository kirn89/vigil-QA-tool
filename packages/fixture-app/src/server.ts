import express from 'express';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';

export type Breakable =
  | 'login-redirect' | 'nav-link' | 'about-image' | 'console-error' | 'items-create' | 'unstyled';

// 1x1 transparent PNG
const OK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

export function createFixtureApp() {
  const broken = new Set<Breakable>();
  let submitHits = 0; // canary: must stay 0 — nav discovery must never submit forms
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  const page = (title: string, body: string) => {
    const style = broken.has('unstyled') ? '' : '<style>body{font:16px sans-serif;margin:2rem}</style>';
    return `<!doctype html><html><head><title>${title}</title>${style}</head><body>${body}</body></html>`;
  };

  app.post('/__break', (req, res) => {
    const feature = req.query['feature'];
    if (typeof feature !== 'string') { res.sendStatus(400); return; }
    broken.add(feature as Breakable);
    res.sendStatus(204);
  });
  app.post('/__reset', (_req, res) => { broken.clear(); submitHits = 0; res.sendStatus(204); });
  app.get('/__echo-ua', (req, res) => { res.json({ ua: req.headers['user-agent'] ?? '' }); });

  app.get('/', (_req, res) => {
    const navHref = broken.has('nav-link') ? '/gone' : '/about';
    const script = broken.has('console-error') ? '<script>console.error("boom from fixture")</script>' : '';
    res.send(page('Home', `<h1>Demo App</h1>
      <nav><a href="/login">Login</a> <a href="${navHref}">About</a> <a href="/contact">Contact</a> <a href="/app">App</a></nav>${script}`));
  });

  app.get('/login', (_req, res) =>
    res.send(page('Login', `<h1>Sign in</h1>
      <form method="post" action="/login">
        <input id="email" name="email" placeholder="Email">
        <input id="password" name="password" type="password" placeholder="Password">
        <button type="submit">Sign in</button>
      </form>`)));

  app.post('/login', (req, res) => {
    if (req.body.email === 'demo@example.com' && req.body.password === 'demo-pass') {
      res.redirect(broken.has('login-redirect') ? '/blank' : '/dashboard');
    } else {
      res.redirect('/login');
    }
  });

  app.get('/dashboard', (_req, res) =>
    res.send(page('Dashboard', `<h1>Welcome back</h1><p>You are logged in.</p><a href="/items">Items</a>`)));

  app.get('/blank', (_req, res) =>
    res.send('<!doctype html><html><head><title>.</title></head><body></body></html>'));

  // Simulates a client-rendered SPA: the body is empty at the `load` event and a
  // script injects the real content shortly after (like React/Next hydration).
  // A sweep must wait for hydration before judging the page rendered.
  app.get('/hydrate', (_req, res) =>
    res.send(`<!doctype html><html><head><title>Hydrate</title><style>body{font:16px sans-serif}</style></head><body><div id="root"></div>
      <script>setTimeout(function(){document.getElementById('root').innerHTML='<main><h1>Loaded</h1><p>This content rendered on the client after load.</p></main>';},150)</script>
    </body></html>`));

  // SPA-style page: /app/inside is reachable ONLY by clicking the nav button
  // (no <a href> points at it), so an href-only crawl misses it. The destructive
  // button and the form submit are canaries: nav discovery must never trigger them.
  app.get('/app', (_req, res) =>
    res.send(page('App', `<h1>App</h1>
      <button id="go" onclick="location.assign('/app/inside')">Open inbox</button>
      <button id="danger" onclick="location.assign('/app/deleted')">Delete account</button>
      <form action="/app/submit" method="post"><input name="x"><button type="submit">Send message</button></form>`)));
  app.get('/app/inside', (_req, res) =>
    res.send(page('Inbox', `<h1>Inbox</h1><p>Your messages live here. Everything looks fine.</p>`)));
  app.get('/app/deleted', (_req, res) =>
    res.send(page('Deleted', `<h1>account deleted</h1><p>this should never be reached by a sweep</p>`)));
  app.post('/app/submit', (_req, res) => { submitHits++; res.send(page('Sent', `<h1>sent</h1>`)); });
  app.get('/__submit-hits', (_req, res) => res.json({ hits: submitHits }));

  app.get('/items', (_req, res) =>
    res.send(page('Items', `<h1>Items</h1>
      <form method="post" action="/items">
        <input name="name" placeholder="Item name">
        <button type="submit">Add item</button>
      </form>`)));

  app.post('/items', (req, res) => {
    if (broken.has('items-create')) { res.status(500).send(page('Error', '<h1>Something went wrong</h1>')); return; }
    res.send(page('Items', `<h1>Items</h1><p>Created: ${req.body.name}</p>`));
  });

  app.get('/contact', (_req, res) =>
    res.send(page('Contact', `<h1>Contact us</h1>
      <form method="post" action="/contact">
        <input name="email" placeholder="Your email">
        <textarea name="message" placeholder="Message"></textarea>
        <button type="submit">Send message</button>
      </form>`)));

  app.post('/contact', (_req, res) =>
    res.send(page('Contact', `<h1>Contact us</h1><p>Thanks, we got your message.</p>`)));

  app.get('/about', (_req, res) => {
    const img = broken.has('about-image') ? '/missing.png' : '/ok.png';
    res.send(page('About', `<h1>About</h1><img src="${img}" alt="team"><p>We are a demo company that exists to be tested.</p>`));
  });

  // Onboarding form exercising the `select` and `upload` primitives. Client-side JS
  // reflects both choices into #result so a flow can assert without server-side
  // multipart parsing (the upload primitive only needs the file set on the input).
  app.get('/onboarding', (_req, res) =>
    res.send(page('Onboarding', `<h1>Create your profile</h1>
      <form>
        <label>Country
          <select name="country">
            <option value="">Select…</option>
            <option value="IN">India</option>
            <option value="US">USA</option>
            <option value="UK">UK</option>
          </select>
        </label>
        <label>Document
          <input type="file" name="document" id="document">
        </label>
        <output id="result">nothing selected yet</output>
      </form>
      <script>
        const c = document.querySelector('select[name="country"]');
        const d = document.getElementById('document');
        const r = document.getElementById('result');
        function update() {
          const country = c.value ? c.options[c.selectedIndex].text : 'none';
          const file = d.files && d.files[0] ? d.files[0].name : 'none';
          r.textContent = 'country=' + country + ' file=' + file;
        }
        c.addEventListener('change', update);
        d.addEventListener('change', update);
      </script>`)));

  app.get('/ok.png', (_req, res) => { res.type('png').send(OK_PNG); });

  return app;
}

export async function startFixture(port = 0): Promise<{ server: Server; url: string }> {
  const app = createFixtureApp();
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      const addr = server.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      resolve({ server, url: `http://127.0.0.1:${actual}` });
    });
  });
}

// Allow `pnpm --filter @vigil/fixture-app start` for manual poking
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startFixture(4999).then(({ url }) => console.log(`fixture app on ${url}`));
}
