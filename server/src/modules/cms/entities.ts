import { z, ZodTypeAny } from 'zod';

export type FieldType = 'text' | 'longtext' | 'image' | 'file' | 'date' | 'datetime' | 'bool' | 'number' | 'select' | 'tags' | 'ref';

export interface Field {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  max?: number;
  help?: string;
  ref?: string;
  readonly?: boolean;
}

export interface Entity {
  key: string;
  label: string;
  group: string;
  table: string;
  pk: 'id' | 'slug';
  fixed?: boolean;
  fields: Field[];
  list: string[];
  search: string[];
  filters?: string[];
  adminOrder: string;
  publicOrder: string;
  publicWhere?: string;
  hasPublished: boolean;
}

const pub: Field = { name: 'published', label: 'Show on website', type: 'bool' };

export const ENTITIES: Entity[] = [
  { key: 'pages', label: 'Pages', group: 'Pages', table: 'pages', pk: 'slug', fixed: true, hasPublished: true,
    fields: [
      { name: 'slug', label: 'Page address', type: 'text', readonly: true },
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'subtitle', label: 'Subtitle / byline', type: 'text', help: "For the principal's message, put the principal's name and title here." },
      { name: 'body', label: 'Content', type: 'longtext', max: 40000, help: 'Plain text. Start a line with ## for a heading, - for a bullet. Leave a blank line between paragraphs.' },
      { name: 'image_url', label: 'Picture', type: 'image' },
      pub],
    list: ['title', 'slug', 'published'], search: ['title', 'slug'], adminOrder: 'slug', publicOrder: 'slug' },
  { key: 'news', label: 'News & announcements', group: 'Updates', table: 'news', pk: 'id', hasPublished: true,
    fields: [
      { name: 'title', label: 'Headline', type: 'text', required: true },
      { name: 'kind', label: 'Type', type: 'select', options: ['news', 'announcement'], required: true },
      { name: 'summary', label: 'Short summary', type: 'longtext', max: 400 },
      { name: 'body', label: 'Full story', type: 'longtext', max: 40000 },
      { name: 'image_url', label: 'Picture', type: 'image' },
      { name: 'pinned', label: 'Pin to top', type: 'bool' },
      { name: 'published_at', label: 'Publish date', type: 'datetime' },
      pub],
    list: ['title', 'kind', 'published_at', 'published'], search: ['title', 'summary'], filters: ['kind'],
    adminOrder: 'published_at desc', publicOrder: 'pinned desc, published_at desc', publicWhere: 'published_at <= now()' },
  { key: 'events', label: 'Events & calendar', group: 'Updates', table: 'events', pk: 'id', hasPublished: true,
    fields: [
      { name: 'title', label: 'Event name', type: 'text', required: true },
      { name: 'category', label: 'Category', type: 'select', options: ['Academic', 'Cultural', 'Sports', 'Holiday', 'Meeting', 'Other'], required: true },
      { name: 'starts_at', label: 'Starts', type: 'datetime', required: true },
      { name: 'ends_at', label: 'Ends', type: 'datetime' },
      { name: 'location', label: 'Place', type: 'text' },
      { name: 'description', label: 'Details', type: 'longtext', max: 5000 },
      { name: 'image_url', label: 'Picture', type: 'image' },
      pub],
    list: ['title', 'category', 'starts_at', 'published'], search: ['title', 'location'], filters: ['category'],
    adminOrder: 'starts_at desc', publicOrder: 'starts_at asc' },
  { key: 'achievements', label: 'Achievements', group: 'Updates', table: 'achievements', pk: 'id', hasPublished: true,
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'category', label: 'Category', type: 'text', max: 60 },
      { name: 'achieved_on', label: 'Date', type: 'date' },
      { name: 'description', label: 'Details', type: 'longtext', max: 5000 },
      { name: 'image_url', label: 'Picture', type: 'image' },
      pub],
    list: ['title', 'category', 'achieved_on', 'published'], search: ['title', 'category'], filters: ['category'],
    adminOrder: 'achieved_on desc nulls last', publicOrder: 'achieved_on desc nulls last, id desc' },
  { key: 'gallery_albums', label: 'Gallery albums', group: 'Gallery', table: 'gallery_albums', pk: 'id', hasPublished: true,
    fields: [
      { name: 'title', label: 'Album title', type: 'text', required: true },
      { name: 'description', label: 'Description', type: 'longtext', max: 1000 },
      { name: 'cover_url', label: 'Cover picture', type: 'image' },
      { name: 'sort', label: 'Order (small numbers first)', type: 'number' },
      pub],
    list: ['title', 'sort', 'published'], search: ['title'], adminOrder: 'sort, id desc', publicOrder: 'sort, id desc' },
  { key: 'gallery_items', label: 'Gallery photos', group: 'Gallery', table: 'gallery_items', pk: 'id', hasPublished: true,
    fields: [
      { name: 'album_id', label: 'Album', type: 'ref', ref: 'gallery_albums', required: true },
      { name: 'image_url', label: 'Photo', type: 'image', required: true },
      { name: 'caption', label: 'Caption', type: 'text', max: 200 },
      { name: 'sort', label: 'Order', type: 'number' },
      pub],
    list: ['caption', 'album_id', 'published'], search: ['caption'], filters: ['album_id'],
    adminOrder: 'album_id, sort, id', publicOrder: 'sort, id' },
  { key: 'departments', label: 'Departments', group: 'People', table: 'departments', pk: 'id', hasPublished: true,
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'description', label: 'About the department', type: 'longtext', max: 5000 },
      { name: 'image_url', label: 'Picture', type: 'image' },
      { name: 'sort', label: 'Order', type: 'number' },
      pub],
    list: ['name', 'sort', 'published'], search: ['name'], adminOrder: 'sort, name', publicOrder: 'sort, name' },
  { key: 'faculty', label: 'Faculty', group: 'People', table: 'faculty', pk: 'id', hasPublished: true,
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'designation', label: 'Designation', type: 'text', required: true },
      { name: 'department_id', label: 'Department', type: 'ref', ref: 'departments' },
      { name: 'qualification', label: 'Qualification', type: 'text' },
      { name: 'bio', label: 'Short bio', type: 'longtext', max: 2000 },
      { name: 'photo_url', label: 'Photo', type: 'image' },
      { name: 'sort', label: 'Order', type: 'number' },
      pub],
    list: ['name', 'designation', 'department_id', 'published'], search: ['name', 'designation'], filters: ['department_id'],
    adminOrder: 'sort, name', publicOrder: 'sort, name' },
  { key: 'curriculum', label: 'Classes & curriculum', group: 'Academics', table: 'curriculum', pk: 'id', hasPublished: true,
    fields: [
      { name: 'stage', label: 'Stage', type: 'select', options: ['Pre-primary', 'Primary', 'Middle', 'Secondary', 'Senior secondary'], required: true },
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'class_label', label: 'Classes covered', type: 'text', help: 'For example: Classes 1 to 5' },
      { name: 'description', label: 'Description', type: 'longtext', max: 5000 },
      { name: 'subjects', label: 'Subjects', type: 'tags', help: 'Separate subjects with commas' },
      { name: 'sort', label: 'Order', type: 'number' },
      pub],
    list: ['title', 'stage', 'class_label', 'published'], search: ['title', 'class_label'], filters: ['stage'],
    adminOrder: 'sort, id', publicOrder: 'sort, id' },
  { key: 'documents', label: 'Documents', group: 'Resources', table: 'documents', pk: 'id', hasPublished: true,
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'category', label: 'Category', type: 'select', options: ['Admissions', 'Policies', 'Circulars', 'Forms', 'Results', 'Other'], required: true },
      { name: 'file_url', label: 'File (PDF)', type: 'file', required: true },
      pub],
    list: ['title', 'category', 'published'], search: ['title'], filters: ['category'],
    adminOrder: 'created_at desc', publicOrder: 'category, created_at desc' },
  { key: 'job_openings', label: 'Job openings', group: 'Resources', table: 'job_openings', pk: 'id', hasPublished: true,
    fields: [
      { name: 'title', label: 'Position', type: 'text', required: true },
      { name: 'department', label: 'Department', type: 'text' },
      { name: 'employment_type', label: 'Type', type: 'select', options: ['Full-time', 'Part-time', 'Contract'], required: true },
      { name: 'description', label: 'Description & requirements', type: 'longtext', max: 10000 },
      { name: 'closes_on', label: 'Last date to apply', type: 'date' },
      pub],
    list: ['title', 'employment_type', 'closes_on', 'published'], search: ['title', 'department'],
    adminOrder: 'created_at desc', publicOrder: 'closes_on nulls last, id desc',
    publicWhere: '(closes_on is null or closes_on >= current_date)' },
  { key: 'alumni', label: 'Alumni stories', group: 'Resources', table: 'alumni', pk: 'id', hasPublished: true,
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'batch_year', label: 'Batch (year)', type: 'number' },
      { name: 'occupation', label: 'Now', type: 'text' },
      { name: 'story', label: 'Story', type: 'longtext', max: 5000 },
      { name: 'photo_url', label: 'Photo', type: 'image' },
      pub],
    list: ['name', 'batch_year', 'occupation', 'published'], search: ['name', 'occupation'],
    adminOrder: 'batch_year desc nulls last', publicOrder: 'batch_year desc nulls last, id' },
];

export const entityByKey = (k: string) => ENTITIES.find((e) => e.key === k);

export const SETTINGS_FIELDS: (Field & { group: string })[] = [
  { group: 'School', name: 'school_name', label: 'School name', type: 'text', required: true },
  { group: 'School', name: 'tagline', label: 'Tagline', type: 'text' },
  { group: 'School', name: 'logo_url', label: 'Logo', type: 'image' },
  { group: 'School', name: 'student_id_format', label: 'Student ID format', type: 'text', max: 30, help: 'Use {YYYY} for the admission year and {NNNN} for the running number. Example: {YYYY}-{NNNN} gives 2026-0001. Changing it affects new students only.' },
  { group: 'Contact', name: 'address', label: 'Address', type: 'longtext', max: 400 },
  { group: 'Contact', name: 'phone', label: 'Phone', type: 'text', max: 40 },
  { group: 'Contact', name: 'email', label: 'Email', type: 'text', max: 120 },
  { group: 'Contact', name: 'office_hours', label: 'Office hours', type: 'text' },
  { group: 'Contact', name: 'map_url', label: 'Map link (https)', type: 'text', max: 500 },
  { group: 'Social', name: 'facebook_url', label: 'Facebook link', type: 'text', max: 300 },
  { group: 'Social', name: 'instagram_url', label: 'Instagram link', type: 'text', max: 300 },
  { group: 'Social', name: 'youtube_url', label: 'YouTube link', type: 'text', max: 300 },
  { group: 'Home page', name: 'hero_headline', label: 'Main headline', type: 'text' },
  { group: 'Home page', name: 'hero_subtext', label: 'Supporting line', type: 'longtext', max: 400 },
  { group: 'Home page', name: 'hero_image_url', label: 'Main picture', type: 'image' },
  { group: 'Home page', name: 'stats', label: 'Key numbers', type: 'longtext', max: 600, help: 'One per line as "Label | Number". Numbers of 0 are hidden on the website.' },
  { group: 'Home page', name: 'admissions_open_text', label: 'Admissions banner text', type: 'text' },
  { group: 'Admissions', name: 'admissions_accepting', label: 'Accepting online applications', type: 'text', max: 5, help: 'Type true to accept applications, false to pause them.' },
  { group: 'Admissions', name: 'admission_required_documents', label: 'Documents required before approval', type: 'text', max: 200, help: 'Comma-separated: birth_certificate, photo, address_proof, transfer_certificate, previous_marksheet. Leave blank for none.' },
  { group: 'Fees', name: 'payment_instructions', label: 'How parents can pay', type: 'longtext', max: 1000, help: 'Shown to parents on the Fees page: counter hours, bank details, UPI ID and so on.' },
  { group: 'Privacy', name: 'privacy_notice_text', label: 'Notice shown on public forms', type: 'longtext', max: 1500, help: 'Shown next to consent boxes. Have this reviewed against your obligations under the DPDP Act, 2023.' },
  { group: 'Privacy', name: 'privacy_notice_version', label: 'Notice version', type: 'text', max: 20, help: 'Increase this whenever the notice text changes. It is stored with every submission.' },
  { group: 'Privacy', name: 'enquiry_retention_days', label: 'Keep closed enquiries for (days)', type: 'text', max: 5, help: 'Closed enquiries and read messages are deleted automatically after this period.' },
];

function urlOk(u: string) {
  return u === '' || u.startsWith('/uploads/') || /^https:\/\/[^\s]+$/.test(u);
}

export function zodFor(f: Field): ZodTypeAny {
  let t: ZodTypeAny;
  switch (f.type) {
    case 'text': t = z.string().trim().max(f.max ?? 200); if (f.required) t = (t as z.ZodString).min(1, 'Required'); break;
    case 'longtext': t = z.string().trim().max(f.max ?? 20000); if (f.required) t = (t as z.ZodString).min(1, 'Required'); break;
    case 'image': case 'file': t = z.string().trim().max(500).refine(urlOk, 'Must be an uploaded file or an https link'); if (f.required) t = t.refine((u: unknown) => u !== '', 'Required'); break;
    case 'date': t = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date'); break;
    case 'datetime': t = z.string().datetime({ offset: true, message: 'Use a valid date and time' }); break;
    case 'bool': t = z.boolean(); break;
    case 'number': t = z.number().int().min(-1_000_000).max(1_000_000_000); break;
    case 'select': t = z.enum(f.options as [string, ...string[]]); break;
    case 'tags': t = z.array(z.string().trim().min(1).max(60)).max(40); break;
    case 'ref': t = z.number().int().positive(); break;
  }
  if (!f.required) t = t.nullable().optional();
  return t;
}

export function schemaFor(e: Entity, partial: boolean) {
  const shape: Record<string, ZodTypeAny> = {};
  for (const f of e.fields) if (!f.readonly) shape[f.name] = zodFor(f);
  const s = z.object(shape).strict();
  return partial ? s.partial() : s;
}
