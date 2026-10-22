/* Authenticated administrator-only classification writes. */
const ENV=['低温','高氧','高温','高温高湿','交叉适应','高原低氧','其他环境'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validPayload(p){
 if(!p||!UUID.test(p.request_id)||!Array.isArray(p.changes)||!p.changes.length||p.changes.length>200||typeof p.note!=='string'||Array.from(p.note).length>200)return false;
 const seen=new Set();
 return p.changes.every(c=>{
  if(!c||!/^W\d{1,20}$/.test(c.paper_id)||seen.has(c.paper_id)||!Number.isInteger(c.expected_revision)||c.expected_revision<0||c.expected_revision>999999999)return false;
  seen.add(c.paper_id);
  return Array.isArray(c.environments)&&c.environments.length<=7&&new Set(c.environments).size===c.environments.length&&c.environments.every(x=>ENV.includes(x))&&Array.isArray(c.source_environments)&&c.source_environments.length<=20&&c.source_environments.every(x=>typeof x==='string'&&x.length<=50);
 });
}
export function createReviewHandler({base,anon,serviceKey,admins=[],fetcher=fetch,origins=['https://lier09.github.io']}={}){
 return async req=>{
  const origin=req.headers.get('origin')||'',headers={'Vary':'Origin','Cache-Control':'no-store','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type'};
  if(!origins.includes(origin))return Response.json({code:'origin_not_allowed'},{status:403,headers});
  headers['Access-Control-Allow-Origin']=origin;
  const respond=(value,status=200)=>Response.json(value,{status,headers});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(!['GET','POST'].includes(req.method))return respond({code:'method_not_allowed'},405);
  if(!base||!anon||!serviceKey||!admins.length)return respond({code:'review_not_configured'},503);
  const bearer=req.headers.get('authorization')||'';
  if(!/^Bearer \S+$/i.test(bearer))return respond({code:'login_required'},401);
  try{
   // Validate user JWT with this project's Auth service. Never trust the JWT
   // body or a caller-supplied reviewer ID/role, nor the public anon JWT.
   const auth=await fetcher(base+'/auth/v1/user',{headers:{apikey:anon,Authorization:bearer},redirect:'error',signal:AbortSignal.timeout(10000)});
   if(!auth.ok)return respond({code:'login_required'},401);
   const user=await auth.json();if(!UUID.test(user.id)||!admins.includes(user.id))return respond({code:'admin_required'},403);
   if(req.method==='GET')return respond({can_review:true});
   if(!/^application\/json(?:;|$)/i.test(req.headers.get('content-type')||''))return respond({code:'json_required'},415);
   if(Number(req.headers.get('content-length'))>100000)return respond({code:'batch_too_large'},413);
   const reader=req.body?.getReader();let parts=[],size=0;
   if(!reader)return respond({code:'invalid_payload'},400);
   try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>100000){await reader.cancel();return respond({code:'batch_too_large'},413);}parts.push(next.value);}}finally{reader.releaseLock();}
   const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
   let p;try{p=JSON.parse(new TextDecoder().decode(bytes));}catch{return respond({code:'invalid_payload'},400);}
   if(!validPayload(p))return respond({code:'invalid_payload'},400);
   const result=await fetcher(base+'/rest/v1/rpc/apply_literature_env_reviews',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:JSON.stringify({p_request_id:p.request_id,p_actor:user.id,p_changes:p.changes,p_note:p.note})});
   const data=await result.json();
   if(!result.ok)return respond({code:data.code==='40001'?'revision_conflict':'write_failed'},data.code==='40001'?409:502);
   return respond(data);
  }catch{return respond({code:'review_service_unavailable'},502);}
 };
}
