import express from 'express';
import type { Server } from 'node:http';

export type Breakable =
  | 'login-redirect' | 'nav-link' | 'about-image' | 'console-error' | 'items-create' | 'unstyled';

// 1x1 transparent PNG
const OK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

export function createFixtureApp() {
  const broken = new Set<Breakable>();
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  const page = (title: string, body: string) => {
    const style = broken.has('unstyled') ? '' : '<style>body{font:16px sans-serif;margin:2rem}</style>';
    return `<!doctype html><html><head><title>${title}</title>${style}</head><body>${body}</body></html>`;
  };

  app.post('/__break', (req, res) => { broken.add(req.query.feature as Breakable); res.sendStatus(204); });
  app.post('/__reset', (_req, res) => { broken.clear(); res.sendStatus(204); });
  app.get('/__echo-ua', (req, res) => { res.json({ ua: req.headers['user-agent'] ?? '' }); });

  app.get('/', (_req, res) => {
    const navHref = broken.has('nav-link') ? '/gone' : '/about';
    const script = broken.has('console-error') ? '<script>console.error("boom from fixture")</script>' : '';
    res.send(page('Home', `<h1>Demo App</h1>
      <nav><a href="/login">Login</a> <a href="${navHref}">About</a> <a href="/contact">Contact</a></nav>${script}`));
  });

  app.get('/login', (_req, res) =>
    res.send(page('Login', `<h1>Sign in</h1>
      <form method="post" action="/login">
        <input name="email" placeholder="Email">
        <input name="password" type="password" placeholder="Password">
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
if (process.argv[1]?.endsWith('server.ts')) {
  startFixture(4999).then(({ url }) => console.log(`fixture app on ${url}`));
}
