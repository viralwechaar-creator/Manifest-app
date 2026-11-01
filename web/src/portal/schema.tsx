import { useEffect, useState } from 'react';
import { api } from '../api';

let cache: any = null;
export function useSchema() {
  const [schema, setSchema] = useState<any>(cache);
  useEffect(() => { if (!cache) api('/admin/cms/schema').then((s) => { cache = s; setSchema(s); }).catch(() => {}); }, []);
  return { schema };
}
export const clearSchemaCache = () => { cache = null; };
