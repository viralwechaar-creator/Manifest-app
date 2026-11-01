import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../../db';
import { audit } from '../../lib/audit';
import { requirePermission } from '../../middleware/auth';
import { asyncH, HttpError } from '../../middleware/errors';
import { notifyFamilies } from './family';

export const libraryRouter = Router();
const manage = requirePermission('library.manage');
const view = (req: any, res: any, next: any) => (req.auth?.permissions.some((p: string) => p === 'library.manage' || p === 'library.view') ? next() : next(new HttpError(req.auth ? 403 : 401, 'You do not have permission to do this.')));
const idp = (v: string) => z.coerce.number().int().positive().parse(v);
const setting = async (k: string, d: number) => { const v = Number((await query('select value from site_settings where key=$1', [k])).rows[0]?.value); return Number.isFinite(v) && v >= 0 ? v : d; };
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
const iso = (v: any) => (v ? new Date(v).toISOString().slice(0, 10) : null);
const today = () => new Date().toISOString().slice(0, 10);
/** Fine accrued so far on an open loan, or the final fine on a returned one. */
export const fineFor = (due: string, on: string, perDay: number) => Math.max(0, daysBetween(due, on)) * perDay;

// ---- catalogue ----
libraryRouter.get('/books', view, asyncH(async (req, res) => {
  const p: unknown[] = []; const where = ['true']; const q = String(req.query.q ?? '').trim();
  if (q) { p.push(`%${q}%`); where.push(`(b.title ilike $${p.length} or b.author ilike $${p.length} or b.isbn ilike $${p.length} or exists (select 1 from book_copies c where c.book_id=b.id and c.accession_no ilike $${p.length}))`); }
  if (req.query.category) { p.push(String(req.query.category)); where.push(`b.category=$${p.length}`); }
  const page = Math.max(1, Number(req.query.page) || 1); const size = 25;
  const total = (await query(`select count(*)::int n from books b where ${where.join(' and ')}`, p)).rows[0].n; p.push(size, (page - 1) * size);
  const rows = (await query(`select b.id, b.title, b.author, b.isbn, b.category, b.publisher, b.published_year,
      (select count(*)::int from book_copies c where c.book_id=b.id) as copies, (select count(*)::int from book_copies c where c.book_id=b.id and c.status='available') as available
    from books b where ${where.join(' and ')} order by lower(b.title) limit $${p.length - 1} offset $${p.length}`, p)).rows;
  res.json({ rows, total, page, size, categories: (await query('select distinct category from books where category is not null order by 1')).rows.map((r) => r.category) });
}));
const book = z.object({ title: z.string().trim().min(1).max(200), author: z.string().trim().min(1).max(120), isbn: z.string().trim().max(20).optional().or(z.literal('')), category: z.string().trim().max(40).optional().or(z.literal('')), publisher: z.string().trim().max(120).optional().or(z.literal('')), publishedYear: z.number().int().min(1000).max(2100).nullable().optional() });
async function addCopies(c: { query: Function }, bookId: number, n: number, shelf?: string | null) {
  const nums: string[] = [];
  for (let i = 0; i < n; i++) { const next = (await c.query("select coalesce(max(substring(accession_no from '[0-9]+$')::int),0)+1 as n from book_copies")).rows[0].n; const acc = `LIB${String(next).padStart(5, '0')}`; await c.query('insert into book_copies (book_id, accession_no, shelf) values ($1,$2,$3)', [bookId, acc, shelf ?? null]); nums.push(acc); }
  return nums;
}
libraryRouter.post('/books', manage, asyncH(async (req, res) => {
  const b = book.extend({ copies: z.number().int().min(1).max(50).optional(), shelf: z.string().trim().max(30).optional() }).parse(req.body);
  const out = await tx(async (c) => { const r = await c.query('insert into books (title, author, isbn, category, publisher, published_year) values ($1,$2,$3,$4,$5,$6) returning id', [b.title, b.author, b.isbn || null, b.category || null, b.publisher || null, b.publishedYear ?? null]); return { id: r.rows[0].id as number, accessionNumbers: await addCopies(c, r.rows[0].id, b.copies ?? 1, b.shelf) }; });
  await audit(req, 'book.added', 'book', out.id); res.status(201).json(out);
}));
libraryRouter.patch('/books/:id', manage, asyncH(async (req, res) => {
  const b = book.partial().parse(req.body);
  const r = await query(`update books set title=coalesce($2,title), author=coalesce($3,author), isbn = case when $4::boolean then nullif($5,'') else isbn end, category = case when $6::boolean then nullif($7,'') else category end, publisher = case when $8::boolean then nullif($9,'') else publisher end where id=$1`, [idp(req.params.id), b.title ?? null, b.author ?? null, 'isbn' in b, b.isbn ?? '', 'category' in b, b.category ?? '', 'publisher' in b, b.publisher ?? '']);
  if (!r.rowCount) throw new HttpError(404, 'Not found'); res.json({ ok: true });
}));
libraryRouter.get('/books/:id/copies', view, asyncH(async (req, res) => {
  res.json((await query(`select c.id, c.accession_no, c.shelf, c.status, l.due_on, coalesce(s.full_name, st.full_name) as borrower from book_copies c left join loans l on l.copy_id=c.id and l.returned_on is null left join students s on s.id=l.student_id left join staff st on st.id=l.staff_id where c.book_id=$1 order by c.accession_no`, [idp(req.params.id)])).rows);
}));
libraryRouter.post('/books/:id/copies', manage, asyncH(async (req, res) => {
  const b = z.object({ count: z.number().int().min(1).max(50), shelf: z.string().trim().max(30).optional() }).parse(req.body);
  if (!(await query('select 1 from books where id=$1', [idp(req.params.id)])).rowCount) throw new HttpError(404, 'Not found');
  res.status(201).json({ accessionNumbers: await tx((c) => addCopies(c, idp(req.params.id), b.count, b.shelf)) });
}));
libraryRouter.patch('/copies/:id', manage, asyncH(async (req, res) => {
  const b = z.object({ status: z.enum(['available', 'lost', 'damaged']).optional(), shelf: z.string().trim().max(30).nullable().optional() }).parse(req.body); const id = idp(req.params.id);
  if ((await query('select 1 from loans where copy_id=$1 and returned_on is null', [id])).rowCount && b.status) throw new HttpError(409, 'This copy is on loan. Return it first.');
  const r = await query("update book_copies set status=coalesce($2,status), shelf = case when $3::boolean then $4 else shelf end where id=$1", [id, b.status ?? null, 'shelf' in b, b.shelf ?? null]);
  if (!r.rowCount) throw new HttpError(404, 'Not found'); await audit(req, 'copy.updated', 'book_copy', id); res.json({ ok: true });
}));
libraryRouter.delete('/books/:id', manage, asyncH(async (req, res) => {
  const id = idp(req.params.id);
  if ((await query('select 1 from loans l join book_copies c on c.id=l.copy_id where c.book_id=$1 limit 1', [id])).rowCount) throw new HttpError(409, 'This book has been borrowed before, so it is kept for the records. Mark its copies lost or damaged instead.');
  const r = await query('delete from books where id=$1', [id]); if (!r.rowCount) throw new HttpError(404, 'Not found'); await audit(req, 'book.deleted', 'book', id); res.json({ ok: true });
}));

// ---- borrowers and loans ----
async function borrower(code: string) {
  const s = (await query("select id, full_name, student_code as code, status from students where student_code=$1", [code])).rows[0];
  if (s) return { kind: 'student' as const, id: s.id as number, name: s.full_name as string, code: s.code as string, active: s.status === 'active' };
  const t = (await query('select id, full_name, staff_code as code, status from staff where staff_code=$1', [code])).rows[0];
  if (t) return { kind: 'staff' as const, id: t.id as number, name: t.full_name as string, code: t.code as string, active: t.status !== 'left' };
  throw new HttpError(404, 'No student or staff member has that ID.');
}
async function standing(b: { kind: 'student' | 'staff'; id: number }) {
  const col = b.kind === 'student' ? 'student_id' : 'staff_id'; const perDay = await setting('library_fine_per_day', 2);
  const open = (await query(`select l.id, bk.title, c.accession_no, to_char(l.due_on,'YYYY-MM-DD') as due_on, l.renewals from loans l join book_copies c on c.id=l.copy_id join books bk on bk.id=c.book_id where l.${col}=$1 and l.returned_on is null order by l.due_on`, [b.id])).rows.map((l) => ({ ...l, fine_so_far: fineFor(l.due_on, today(), perDay) }));
  const unpaid = Number((await query(`select coalesce(sum(fine),0)::float t from loans where ${col}=$1 and returned_on is not null and fine > 0 and not fine_paid`, [b.id])).rows[0].t);
  return { open, unpaidFines: unpaid, limit: await setting(b.kind === 'student' ? 'library_max_books_student' : 'library_max_books_staff', b.kind === 'student' ? 3 : 5) };
}
libraryRouter.get('/borrowers/:code', manage, asyncH(async (req, res) => { const b = await borrower(req.params.code); res.json({ ...b, ...(await standing(b)) }); }));
libraryRouter.post('/issue', manage, asyncH(async (req, res) => {
  const b = z.object({ accessionNo: z.string().trim().min(3).max(30), borrowerCode: z.string().trim().min(1).max(30) }).parse(req.body);
  const out = await tx(async (c) => {
    const copy = (await c.query('select c.id, c.status, bk.title from book_copies c join books bk on bk.id=c.book_id where c.accession_no=$1 for update of c', [b.accessionNo.toUpperCase()])).rows[0];
    if (!copy) throw new HttpError(404, 'No copy has that accession number.'); if (copy.status !== 'available') throw new HttpError(409, `This copy is ${copy.status === 'issued' ? 'already on loan' : copy.status}.`);
    const who = await borrower(b.borrowerCode); if (!who.active) throw new HttpError(409, `${who.name} is not an active ${who.kind}.`);
    const st = await standing(who);
    if (st.open.length >= st.limit) throw new HttpError(409, `${who.name} already has ${st.open.length} books out (the limit is ${st.limit}).`);
    if (st.unpaidFines > 0) throw new HttpError(409, `${who.name} has unpaid library fines of ₹${st.unpaidFines}. Collect them first.`);
    if (st.open.some((l: any) => l.fine_so_far > 0)) throw new HttpError(409, `${who.name} has an overdue book. It must be returned first.`);
    const due = new Date(Date.now() + (await setting('library_loan_days', 14)) * 86400000).toISOString().slice(0, 10);
    const r = await c.query(`insert into loans (copy_id, ${who.kind === 'student' ? 'student_id' : 'staff_id'}, due_on, issued_by) values ($1,$2,$3,$4) returning id`, [copy.id, who.id, due, req.auth!.user.id]);
    await c.query("update book_copies set status='issued' where id=$1", [copy.id]);
    return { id: r.rows[0].id as number, title: copy.title, due, borrower: who };
  });
  if (out.borrower.kind === 'student') await notifyFamilies('select id from students where id=$1', [out.borrower.id], 'Library book issued', `${out.title}, due ${out.due}`, '/family/library');
  await audit(req, 'library.issued', 'loan', out.id); res.status(201).json({ id: out.id, title: out.title, dueOn: out.due, borrower: out.borrower.name });
}));
libraryRouter.post('/loans/:id/return', manage, asyncH(async (req, res) => {
  const b = z.object({ condition: z.enum(['ok', 'damaged', 'lost']).default('ok') }).parse(req.body ?? {}); const id = idp(req.params.id);
  const out = await tx(async (c) => {
    const l = (await c.query('select l.*, to_char(l.due_on,\'YYYY-MM-DD\') as due from loans l where l.id=$1 for update', [id])).rows[0];
    if (!l) throw new HttpError(404, 'Not found'); if (l.returned_on) throw new HttpError(409, 'Already returned.');
    const fine = fineFor(l.due, today(), await setting('library_fine_per_day', 2));
    await c.query('update loans set returned_on=current_date, returned_by=$2, fine=$3 where id=$1', [id, req.auth!.user.id, fine]);
    await c.query('update book_copies set status=$2 where id=$1', [l.copy_id, b.condition === 'ok' ? 'available' : b.condition]);
    return { fine, studentId: l.student_id as number | null };
  });
  if (out.fine > 0 && out.studentId) await notifyFamilies('select id from students where id=$1', [out.studentId], 'Library fine', `A late fee of ₹${out.fine} applies. Please pay at the library.`, '/family/library');
  await audit(req, 'library.returned', 'loan', id, { fine: out.fine, condition: b.condition }); res.json({ fine: out.fine });
}));
libraryRouter.post('/loans/:id/renew', manage, asyncH(async (req, res) => {
  const id = idp(req.params.id);
  const l = (await query("select renewals, to_char(due_on,'YYYY-MM-DD') as due, returned_on from loans where id=$1", [id])).rows[0];
  if (!l) throw new HttpError(404, 'Not found'); if (l.returned_on) throw new HttpError(409, 'Already returned.');
  if (l.renewals >= 1) throw new HttpError(409, 'A book can be renewed only once.'); if (l.due < today()) throw new HttpError(409, 'An overdue book cannot be renewed. Return it first.');
  const days = await setting('library_loan_days', 14);
  await query("update loans set due_on = due_on + $2::int, renewals = renewals + 1 where id=$1", [id, days]); await audit(req, 'library.renewed', 'loan', id); res.json({ ok: true });
}));
libraryRouter.post('/loans/:id/fine-paid', manage, asyncH(async (req, res) => {
  const r = await query('update loans set fine_paid=true where id=$1 and fine > 0 and returned_on is not null and not fine_paid', [idp(req.params.id)]);
  if (!r.rowCount) throw new HttpError(404, 'No unpaid fine on that loan.'); await audit(req, 'library.fine_collected', 'loan', req.params.id); res.json({ ok: true });
}));
libraryRouter.get('/loans', view, asyncH(async (req, res) => {
  const st = String(req.query.status ?? 'open'); const q = String(req.query.q ?? '').trim(); const p: unknown[] = []; const where = ['true'];
  if (st === 'open') where.push('l.returned_on is null'); if (st === 'overdue') where.push('l.returned_on is null and l.due_on < current_date'); if (st === 'fines') where.push('l.fine > 0 and not l.fine_paid and l.returned_on is not null');
  if (q) { p.push(`%${q}%`); where.push(`(bk.title ilike $${p.length} or c.accession_no ilike $${p.length} or coalesce(s.full_name, t.full_name) ilike $${p.length} or coalesce(s.student_code, t.staff_code) ilike $${p.length})`); }
  const perDay = await setting('library_fine_per_day', 2);
  const rows = (await query(`select l.id, bk.title, c.accession_no, coalesce(s.full_name, t.full_name) as borrower, coalesce(s.student_code, t.staff_code) as code, case when l.student_id is null then 'staff' else 'student' end as kind,
      to_char(l.issued_on,'YYYY-MM-DD') as issued_on, to_char(l.due_on,'YYYY-MM-DD') as due_on, to_char(l.returned_on,'YYYY-MM-DD') as returned_on, l.fine::float as fine, l.fine_paid, l.renewals
      from loans l join book_copies c on c.id=l.copy_id join books bk on bk.id=c.book_id left join students s on s.id=l.student_id left join staff t on t.id=l.staff_id where ${where.join(' and ')} order by l.due_on limit 300`, p)).rows;
  res.json(rows.map((r) => ({ ...r, overdue: !r.returned_on && r.due_on < today(), fine_so_far: r.returned_on ? r.fine : fineFor(r.due_on, today(), perDay) })));
}));

/** What a family may see about their child's library activity. */
export async function libraryFor(studentId: number) {
  const perDay = await setting('library_fine_per_day', 2);
  const rows = (await query(`select bk.title, bk.author, to_char(l.issued_on,'YYYY-MM-DD') as issued_on, to_char(l.due_on,'YYYY-MM-DD') as due_on, to_char(l.returned_on,'YYYY-MM-DD') as returned_on, l.fine::float as fine, l.fine_paid from loans l join book_copies c on c.id=l.copy_id join books bk on bk.id=c.book_id where l.student_id=$1 order by l.issued_on desc limit 40`, [studentId])).rows;
  const open = rows.filter((r) => !r.returned_on).map((r) => ({ ...r, overdue: r.due_on < today(), fine_so_far: fineFor(r.due_on, today(), perDay) }));
  return { open, history: rows.filter((r) => r.returned_on), unpaidFines: rows.filter((r) => r.returned_on && r.fine > 0 && !r.fine_paid).reduce((a, r) => a + r.fine, 0) };
}
/** Reminders for overdue books, once per loan. */
export async function sendLibraryReminders() {
  const rows = (await query("select l.id, l.student_id, bk.title from loans l join book_copies c on c.id=l.copy_id join books bk on bk.id=c.book_id where l.returned_on is null and l.due_on < current_date and l.reminded_at is null and l.student_id is not null")).rows;
  for (const r of rows) { const u = await query('update loans set reminded_at=now() where id=$1 and reminded_at is null', [r.id]); if (u.rowCount) await notifyFamilies('select id from students where id=$1', [r.student_id], 'Library book overdue', `${r.title} is overdue. Late fees apply daily.`, '/family/library'); }
  return rows.length;
}
void iso;
