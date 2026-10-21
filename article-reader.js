/* Render trusted structure from untrusted JATS as inert, semantic HTML. No startup I/O. */
(function(w){
 'use strict';var d=w.document;
 function text(el){return (el&&el.textContent||'').trim();}
 function language(value){var s=String(value||''),han=(s.match(/[\u3400-\u9fff]/g)||[]).length,latin=(s.match(/[a-z]/gi)||[]).length;return han>latin*.2?'zh-CN':latin>15?'en':'und';}
 function safeURL(v){try{var u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch(e){return '';}}
 function node(tag,value){var n=d.createElement(tag);if(value!==undefined)n.textContent=value;return n;}
 function abstract(value){var el=node('article');el.className='article-prose';el.lang=language(value);el.setAttribute('translate','yes');
  String(value||'原始来源暂无摘要。').split(/\n\s*\n/).forEach(function(s){el.appendChild(node('p',s));});return el;
 }
 function parse(xml,pmcid){
  if(typeof xml!=='string'||xml.length>8*1024*1024||/<!ENTITY/i.test(xml))throw Error('全文 XML 格式无效或过大。');
  var doc=new DOMParser().parseFromString(xml,'application/xml');if(doc.querySelector('parsererror')||!doc.querySelector('article > body'))throw Error('来源未返回可读的论文全文。');
  var body=doc.querySelector('article > body');if(text(body).length<100)throw Error('来源未提供完整正文。');
  var front=doc.querySelector('article-meta'),doi=text(front&&front.querySelector('article-id[pub-id-type="doi"]'));
  var prefix='ar-'+pmcid+'-',toc=[],source='https://europepmc.org/articles/'+pmcid;
  function id(v){return prefix+String(v||'').replace(/[^\w-]/g,'_');}
  function renderChildren(src,target,depth){Array.from(src.childNodes).forEach(function(c){var r=render(c,depth);if(r)target.appendChild(r);});return target;}
  function render(src,depth){
   if(src.nodeType===3)return d.createTextNode(src.nodeValue);if(src.nodeType!==1)return null;
   var name=src.localName,el,href;
   if(['script','style','iframe','object','embed','media','supplementary-material','graphic','inline-graphic','permissions'].includes(name))return null;
   if(name==='sec'){el=node('section');if(src.id)el.id=id(src.id);return renderChildren(src,el,Math.min(depth+1,6));}
   if(name==='title'){el=node('h'+Math.min(Math.max(depth,2),6),text(src));var sec=src.parentElement;if(sec&&sec.localName==='sec'){if(!sec.id)sec.setAttribute('id','section-'+toc.length);el.id=id(sec.id)+'-heading';toc.push({title:text(src),id:el.id});}return el;}
   if(name==='fig'){
    el=node('figure');if(src.id)el.id=id(src.id);var graphic=src.querySelector('graphic'),url='';
    if(graphic){Array.from(graphic.childNodes).forEach(function(pi){if(pi.nodeType===7&&pi.target==='image-cloudpmc-urn'&&/^urn:cdn:blobs\/[\w/.-]+\.(?:png|jpe?g|webp|gif)$/i.test(pi.data.trim()))url='https://cdn.ncbi.nlm.nih.gov/pmc/blobs/'+pi.data.trim().slice('urn:cdn:blobs/'.length);});}
    if(url){var img=node('img');img.src=url;img.alt=text(src.querySelector('label'))||'论文原图';img.loading='lazy';img.referrerPolicy='no-referrer';img.onerror=function(){this.hidden=true;};el.appendChild(img);}
    var caption=node('figcaption');var label=src.querySelector('label');if(label)caption.appendChild(node('strong',text(label)+' '));var cap=src.querySelector('caption');if(cap)renderChildren(cap,caption,Math.min(depth+1,6));el.appendChild(caption);
    var a=node('a','在来源页查看原图 ↗');a.href=source+(src.id?'#'+encodeURIComponent(src.id):'');a.target='_blank';a.rel='noopener noreferrer';el.appendChild(a);return el;
   }
   if(name==='table-wrap'){el=node('figure');if(src.id)el.id=id(src.id);var cap=node('figcaption',text(src.querySelector('label'))+' '+text(src.querySelector('caption')));el.appendChild(cap);var table=src.querySelector('table');if(table){var wrap=node('div');wrap.className='article-table';wrap.tabIndex=0;wrap.setAttribute('aria-label','论文数据表，可横向滚动');wrap.appendChild(render(table,depth));el.appendChild(wrap);}var foot=src.querySelector('table-wrap-foot');if(foot)el.appendChild(node('p',text(foot)));return el;}
   if(name==='ext-link'||name==='uri'){href=safeURL(src.getAttributeNS('http://www.w3.org/1999/xlink','href')||text(src));if(!href)return node('span',text(src));el=node('a');el.href=href;el.target='_blank';el.rel='noopener noreferrer';return renderChildren(src,el,depth);}
   if(name==='xref'){el=node('a');var rid=src.getAttribute('rid')||'';if(/^[\w.-]+$/.test(rid))el.href='#'+id(rid);return renderChildren(src,el,depth);}
   if(name==='inline-formula'||name==='disp-formula'){el=node(name==='disp-formula'?'p':'span',text(src.querySelector('tex-math')||src));el.className='article-formula';return el;}
   var tags={p:'p',bold:'strong',italic:'em',sup:'sup',sub:'sub',underline:'u',list:'ul','list-item':'li',table:'table',thead:'thead',tbody:'tbody',tfoot:'tfoot',tr:'tr',td:'td',th:'th',break:'br',label:'span',ref:'li','mixed-citation':'span','element-citation':'span',caption:'figcaption'};
   el=node(tags[name]||'span');if(src.id)el.id=id(src.id);
   if(name==='td'||name==='th')['colspan','rowspan'].forEach(function(a){var n=Number(src.getAttribute(a));if(n>=1&&n<=50)el.setAttribute(a,n);});
   if(name==='list'&&src.getAttribute('list-type')==='order')el=node('ol');
   return renderChildren(src,el,depth);
  }
  var article=node('article');article.className='article-prose article-full';article.lang=doc.documentElement.getAttribute('xml:lang')||language(text(body));article.setAttribute('translate','yes');
  var abs=front&&front.querySelector('abstract');if(abs){var section=node('section');section.appendChild(node('h2','Abstract'));renderChildren(abs,section,3);article.appendChild(section);}
  renderChildren(body,article,2);
  var refs=doc.querySelector('back > ref-list');if(refs){var details=node('details'),sum=node('summary','References');details.appendChild(sum);var list=node('ol');Array.from(refs.children).filter(function(c){return c.localName==='ref';}).forEach(function(c){list.appendChild(render(c,2));});details.appendChild(list);article.appendChild(details);}
  if(toc.length){var nav=node('details');nav.className='article-toc';nav.lang='zh-CN';nav.appendChild(node('summary','文章目录'));var list=node('ol');toc.forEach(function(t){var li=node('li'),a=node('a',t.title);a.lang=article.lang;a.href='#'+t.id;li.appendChild(a);list.appendChild(li);});nav.appendChild(list);article.prepend(nav);}
  var license=text(front&&front.querySelector('permissions'));if(license){var foot=node('footer');foot.className='article-license';foot.appendChild(node('p',license));article.appendChild(foot);}
  return {article:article,doi:doi,title:text(front&&front.querySelector('article-title')),source:source,license:license};
 }
 w.LitdbArticle={abstract:abstract,parse:parse,language:language};
})(window);
