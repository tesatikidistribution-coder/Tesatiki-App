import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// Ensure CONFIG is loaded first
if (!window.CONFIG) throw new Error("CONFIG not loaded! Make sure config.js loads first.");

// Initialize Supabase
export const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);