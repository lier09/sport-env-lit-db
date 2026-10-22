import {createReviewHandler} from './service.mjs';
Deno.serve(createReviewHandler({
 base: Deno.env.get('SUPABASE_URL'),
 anon: Deno.env.get('SUPABASE_ANON_KEY'),
 serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
 admins: (Deno.env.get('ENV_REVIEW_ADMIN_IDS')||'').split(',').map(s=>s.trim()).filter(Boolean),
 origins: (Deno.env.get('ENV_REVIEW_ALLOWED_ORIGINS')||'https://lier09.github.io').split(',').map(s=>s.trim()).filter(Boolean),
}));
