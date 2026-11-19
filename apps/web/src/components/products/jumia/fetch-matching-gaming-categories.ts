import { createClient } from '@/lib/supabase/client';
import { jumiaPreviewMessages } from './constants';

export async function fetchMatchingGamingCategories(merchantId: string) {
  const categories: { id: string; name: string | null }[] = [];
  const client = createClient();
  for (let start = 0; ; ) {
    const { data, error } = await client
      .from('categories')
      .select('id, name')
      .eq('merchant_id', merchantId)
      .eq('is_active', true)
      .ilike('name', '%Gaming%')
      .order('id', { ascending: true })
      .range(start, start + jumiaPreviewMessages.categoryPageSize - 1);
    if (error) return { data: null, error };
    categories.push(...(data ?? []));
    if (!data || data.length < jumiaPreviewMessages.categoryPageSize) {
      return { data: categories, error: null };
    }
    start += jumiaPreviewMessages.categoryPageSize;
  }
}
