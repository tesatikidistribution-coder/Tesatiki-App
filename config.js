// Simple Tesatiki Configuration

const CONFIG = {
  APP_NAME: "Tesatiki",

  // Supabase
  SUPABASE_URL: "https://gpkufzayrvfippxqfafa.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdwa3VmemF5cnZmaXBweHFmYWZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk0NjMwNDQsImV4cCI6MjA4NTAzOTA0NH0.3YHPrjJ65mn20ECCYCvbO56jWWUVLy1IGFzXp83Gn9U",

  // API (Cloudflare Pages Functions if you add later)
  API_BASE_URL: "/api",

  // Validation
  PASSWORD_MIN: 6,
  PHONE_REGEX: /^(0|256)(7[0-9])\d{7}$/
};

// Make available globally
window.CONFIG = CONFIG;