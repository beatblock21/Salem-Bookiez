import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

console.log('URL:', SUPABASE_URL, 'KEY:', SUPABASE_ANON)

if (!SUPABASE_URL || !SUPABASE_ANON) {
  throw new Error('Missing Supabase environment variables. Check your .env.local file.')
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON)