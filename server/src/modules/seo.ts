import { Router } from 'express';
import { config } from '../config';
import { query } from '../db';
import { asyncH } from '../middleware/errors';

/** robots.txt and sitemap.xml: public pages only. Private areas, the API and personal data are never listed. */
export const seoRouter = Router();
const base = () => new URL(config.PUBLIC_ORIGIN).origin;
const PAGES = ['', 'about', 'principal', 'vision-mission', 'academics', 'curriculum', 'departments', 'faculty', 'infrastructure', 'admissions', 'admissions/enquiry', 'admissions/apply', 'gallery', 'events', 'achievements', 'news', 'calendar', 'transport', 'alumni', 'careers', 'contact', 'policies', 'documents'];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

seoRouter.get('/robots.txt', (_req, res) => {
  res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(`User-agent: *\nAllow: /\nDisallow: /portal\nDisallow: /family\nDisallow: /login\nDisallow: /api/\nDisallow: /uploads/private\n\nSitemap: ${base()}/sitemap.xml\n`);
});
seoRouter.get('/sitemap.xml', asyncH(async (_req, res) => {
  const urls = PAGES.map((p) => ({ loc: `${base()}/${p}`.replace(/\/$/, p ? '' : '/'), freq: p === '' ? 'weekly' : 'monthly' }));
  const news = (await query("select id from news where published order by id desc limit 200").catch(() => ({ rows: [] as { id: number }[] }))).rows;
  const albums = (await query('select id from gallery_albums where published order by id desc limit 100').catch(() => ({ rows: [] as { id: number }[] }))).rows;
  for (const n of news) urls.push({ loc: `${base()}/news/${n.id}`, freq: 'yearly' });
  for (const a of albums) urls.push({ loc: `${base()}/gallery/${a.id}`, freq: 'yearly' });
  res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u.loc)}</loc><changefreq>${u.freq}</changefreq></url>`).join('\n')}\n</urlset>\n`);
}));
