import { createHandler } from './service.mjs';

// Gateway verifies the existing project's public anon JWT. No service-role key
// or database permissions are used by this function. Browser keys are NEVER
// forwarded upstream; an optional server-owned OpenAlex key stays server-side.
Deno.serve(createHandler({
  openalexKey: Deno.env.get('PDF_OPENALEX_KEY') || '',
  origins: (Deno.env.get('PDF_ALLOWED_ORIGINS') || 'https://lier09.github.io')
    .split(',').map(value => value.trim()).filter(Boolean),
}));
