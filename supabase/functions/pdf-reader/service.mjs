/* Open PDF relay: DOI/Work ID only, never an arbitrary URL proxy.
 * No database access, cookies, institutional credentials or PDF persistence.
 * The hostname list is intentional; unknown repositories require review.
 */
const PDF_HOSTS = [
  'frontiersin.org', 'pmc.ncbi.nlm.nih.gov', 'pmc-oa-opendata.s3.amazonaws.com',
  'europepmc.org', 'mdpi.com', 'mdpi-res.com', 'journals.plos.org',
  'biomedcentral.com', 'link.springer.com', 'link.springernature.com',
  'media.springernature.com', 'nature.com', 'elifesciences.org', 'peerj.com',
  'academic.oup.com', 'oup.silverchair-cdn.com', 'onlinelibrary.wiley.com',
  'sciencedirect.com', 'sciencedirectassets.com',
];
const META_HOSTS = ['api.crossref.org', 'api.openalex.org'];
const MAX_PDF = 25 * 1024 * 1024;
const MAX_META = 2 * 1024 * 1024;

class Failure extends Error {
  constructor(code, status = 422) { super(code); this.code = code; this.status = status; }
}

function normalizeDOI(value) {
  return String(value || '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').trim().toLowerCase();
}

export function allowedURL(value, hosts = PDF_HOSTS) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
    if (!hosts.some(host => u.hostname === host || (hosts === PDF_HOSTS && u.hostname.endsWith('.' + host)))) return null;
    // Credentials, access tokens and caller-supplied API keys are never relayed.
    for (const name of u.searchParams.keys()) if (/^(api[_-]?key|access_token|authorization)$/i.test(name)) return null;
    return u;
  } catch { return null; }
}

async function bytes(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel(); throw new Failure('file_too_large', 413);
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > limit) throw new Failure('file_too_large', 413);
      chunks.push(part.value);
    }
  } catch (e) { await reader.cancel().catch(() => {}); throw e; }
  finally { reader.releaseLock(); }
  const all = new Uint8Array(size); let offset = 0;
  for (const part of chunks) { all.set(part, offset); offset += part.length; }
  return all;
}

async function upstream(value, hosts, fetcher, signal, apiKey) {
  let url = allowedURL(value, hosts);
  if (!url) throw new Failure('unsupported_source');
  for (let i = 0; i < 5; i++) {
    const signed = new URL(url);
    if (apiKey && signed.hostname === 'api.openalex.org') signed.searchParams.set('api_key', apiKey);
    const res = await fetcher(signed.href, {
      method: 'GET', redirect: 'manual', credentials: 'omit', signal,
      headers: {Accept: hosts === META_HOSTS ? 'application/json' : 'application/pdf,text/html;q=0.5'},
    });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location'); await res.body?.cancel();
      const next = location && allowedURL(new URL(location, url).href, hosts);
      if (!next) throw new Failure('blocked_redirect');
      url = next; continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Failure(res.status === 429 ? 'upstream_rate_limited' : 'source_unavailable', res.status === 429 ? 429 : 502);
    }
    return {response: res, url: url.href};
  }
  throw new Failure('redirect_limit');
}

function metadataFromHTML(html) {
  const result = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = {};
    for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)) attrs[m[1].toLowerCase()] = m[3].replace(/&amp;/g, '&');
    const key = (attrs.name || attrs.property || '').toLowerCase();
    if (key) result[key] = attrs.content || '';
  }
  return result;
}

function licensedCrossref(message, now) {
  return (message.license || []).some(item => {
    const url = String(item.URL || '');
    const started = item.start?.['date-time'];
    return /^https?:\/\/creativecommons\.org\/(?:licenses|publicdomain)\//i.test(url) && (!started || Date.parse(started) <= now);
  });
}

export function createHandler({fetcher = fetch, openalexKey = '',
  origins = ['https://lier09.github.io'], clock = Date.now, timeoutMs = 28000,
  maxPDF = MAX_PDF, perIP = 8, perWindow = 60, concurrent = 2} = {}) {
  const buckets = new Map(); let active = 0;
  function quota(ip) {
    const now = clock();
    for (const [id, item] of buckets) if (item.until <= now) buckets.delete(id);
    if (buckets.size >= 2000 && !buckets.has('ip:' + ip)) return false;
    const add = id => { const b = buckets.get(id) || {count: 0, until: now + 600000}; b.count++; buckets.set(id, b); return b.count; };
    return add('ip:' + ip) <= perIP && add('global') <= perWindow && active < concurrent;
  }
  return async function handle(req) {
    const origin = req.headers.get('origin') || '';
    const cors = {'Vary': 'Origin', 'Cache-Control': 'no-store',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Expose-Headers': 'X-Litdb-Source, X-Litdb-DOI, X-Litdb-Protocol, Retry-After',
      'X-Litdb-Protocol': '1'};
    if (!origins.includes(origin)) return Response.json({code: 'origin_not_allowed'}, {status: 403, headers: cors});
    cors['Access-Control-Allow-Origin'] = origin;
    const fail = (code, status, headers = {}) => Response.json({code}, {status, headers: {...cors, ...headers}});
    if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});
    if (req.method !== 'POST') return fail('method_not_allowed', 405);
    if (!/^application\/json(?:;|$)/i.test(req.headers.get('content-type') || '')) return fail('json_required', 415);
    if (Number(req.headers.get('content-length')) > 2048) return fail('request_too_large', 413);
    let body;
    try { body = JSON.parse(new TextDecoder().decode(await bytes(req, 2048))); }
    catch { return fail('invalid_request', 400); }
    if (!body || typeof body !== 'object' || Object.keys(body).some(k => !['doi', 'workId'].includes(k))) return fail('identifier_only', 400);
    let doi = normalizeDOI(body.doi), workId = String(body.workId || '').toUpperCase();
    if (doi && (!/^10\.\d{4,9}\/[^\s<>"#?]{1,180}$/.test(doi))) return fail('invalid_identifier', 400);
    if (workId && !/^W\d{1,20}$/.test(workId)) return fail('invalid_identifier', 400);
    if (!doi && !workId) return fail('identifier_required', 400);
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
    if (!quota(ip)) return fail('service_busy', 429, {'Retry-After': '600'});
    active++;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    const cancel = () => controller.abort(); req.signal.addEventListener('abort', cancel, {once: true});
    if (req.signal.aborted) controller.abort();
    let last = new Failure('no_open_pdf', 404);
    try {
      const candidates = [], landings = [];
      const add = (list, value) => { const u = allowedURL(value); if (u && !list.includes(u.href) && list.length < 4) list.push(u.href); };
      if (doi) {
        try {
          const cr = await upstream('https://api.crossref.org/works/' + encodeURIComponent(doi), META_HOSTS, fetcher, controller.signal);
          const data = JSON.parse(new TextDecoder().decode(await bytes(cr.response, MAX_META))).message;
          if (normalizeDOI(data?.DOI) === doi && licensedCrossref(data, clock())) {
            for (const link of data.link || []) {
              if (link['content-type'] === 'application/pdf') add(candidates, link.URL);
              else add(landings, link.URL);
            }
            // DOI redirects are not fetched blindly; only registered publisher URLs.
            add(landings, data.resource?.primary?.URL);
          }
        } catch (e) { last = e; }
      }
      const download = async url => {
        const result = await upstream(url, PDF_HOSTS, fetcher, controller.signal);
        const data = await bytes(result.response, maxPDF);
        if (data.length < 8 || new TextDecoder().decode(data.subarray(0, 5)) !== '%PDF-') throw new Failure('source_not_pdf');
        return new Response(data, {headers: {...cors, 'Content-Type': 'application/pdf',
          'Content-Length': String(data.length), 'Content-Disposition': 'inline; filename="paper.pdf"',
          'X-Content-Type-Options': 'nosniff', 'X-Litdb-Source': result.url,
          'X-Litdb-DOI': doi}});
      };
      const tryCandidates = async () => {
        while (candidates.length) {
          try { return await download(candidates.shift()); } catch (e) { last = e; }
        }
        return null;
      };
      let result = await tryCandidates(); if (result) return result;
      for (const landing of landings.slice(0, 2)) {
        try {
          const page = await upstream(landing, PDF_HOSTS, fetcher, controller.signal);
          const html = new TextDecoder().decode(await bytes(page.response, MAX_META));
          const meta = metadataFromHTML(html);
          if (normalizeDOI(meta.citation_doi || meta['prism.doi'] || meta['dc.identifier']?.replace(/^doi:/i, '')) !== doi) continue;
          add(candidates, meta.citation_pdf_url);
        } catch (e) { last = e; }
        result = await tryCandidates(); if (result) return result;
      }
      // Crossref licenses/links are often absent. Try all OA locations registered
      // for this exact work, rather than only best_oa_location.
      try {
        const id = doi ? 'doi:' + encodeURIComponent(doi) : workId;
        const url = new URL('https://api.openalex.org/works/' + id);
        url.searchParams.set('select', 'id,doi,open_access,best_oa_location,locations');
        const oa = await upstream(url.href, META_HOSTS, fetcher, controller.signal, openalexKey);
        const data = JSON.parse(new TextDecoder().decode(await bytes(oa.response, MAX_META)));
        if (doi && normalizeDOI(data.doi) !== doi) throw new Failure('identifier_mismatch');
        if (!doi && data.id !== 'https://openalex.org/' + workId) throw new Failure('identifier_mismatch');
        doi = normalizeDOI(data.doi);
        for (const location of [data.best_oa_location, ...(data.locations || [])]) {
          if (location && location.is_oa === true) add(candidates, location.pdf_url);
        }
      } catch (e) { last = e; }
      result = await tryCandidates(); if (result) return result;
      if(controller.signal.aborted)return fail('download_timeout',504);
      return fail(last instanceof Failure ? last.code : 'source_unavailable', last instanceof Failure ? last.status : 502);
    } catch (e) {
      return fail(controller.signal.aborted ? 'download_timeout' : e instanceof Failure ? e.code : 'source_unavailable',
                  controller.signal.aborted ? 504 : e instanceof Failure ? e.status : 502);
    } finally {
      clearTimeout(timer); active--; req.signal.removeEventListener('abort', cancel);
    }
  };
}
