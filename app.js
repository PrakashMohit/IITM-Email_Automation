// â•â•â• STATE â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let recipients = [];
let logs = [];
let currentPortal = localStorage.getItem('iitm_portal') || 'ds';
let isSending = false;
let stopFlag = false;
let cronTimer = null;
let pollTimer = null;
let cronOn = false;
let pollOn = false;
let previewIdx = null;

// â•â•â• CONFIG â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function cfg(id) { return (document.getElementById(id)||{}).value || ''; }
function portalLabel() { return currentPortal === 'es' ? 'Embedded Systems' : 'Data Science'; }
function storageKey(base) { return `${base}_${currentPortal}`; }
function linesFrom(id) { return cfg(id).split(/\r?\n/).map(v=>v.trim()).filter(Boolean); }
function getPortalConfig(c) { return (c.portals && c.portals[currentPortal]) || {}; }

function saveConfig() {
  let existing; try { existing = JSON.parse(localStorage.getItem('iitm_cfg')||'{}'); } catch { existing={}; }
  existing.portals = existing.portals || {};
  existing.portals[currentPortal] = {
    sheetUrl: cfg('sheet-url'),
    assetLinks: cfg('asset-links'),
    attachmentPaths: cfg('attachment-paths')
  };
  const c = {
    backendUrl: cfg('backend-url'), ollamaUrl: cfg('ollama-url'),
    ollamaModel: cfg('ollama-model'),
    senderEmail: cfg('sender-email'), gmailPass: cfg('gmail-pass'),
    fromName: cfg('from-name'), subjectTemplate: cfg('subject-template'),
    aiPrompt: cfg('ai-prompt-template'), signature: cfg('signature'),
    cronTime: cfg('cron-time'), sheetUrl: cfg('sheet-url'),
    pollInterval: cfg('poll-interval'), sendDelay: cfg('send-delay'),
    assetLinks: cfg('asset-links'), attachmentPaths: cfg('attachment-paths'),
    portals: existing.portals
  };
  localStorage.setItem('iitm_cfg', JSON.stringify(c));
  saveAssets();
}

function loadConfig() {
  let c; try { c = JSON.parse(localStorage.getItem('iitm_cfg')||'{}'); } catch { c={}; }
  const pc = getPortalConfig(c);
  const set = (id,v) => { const el=document.getElementById(id); if(el&&v) el.value=v; };
  set('backend-url', c.backendUrl); set('ollama-url', c.ollamaUrl||'http://localhost:11434');
  set('ollama-model', c.ollamaModel||'llama3.2');
  set('sender-email', c.senderEmail); set('gmail-pass', c.gmailPass);
  set('from-name', c.fromName); set('subject-template', c.subjectTemplate);
  set('ai-prompt-template', c.aiPrompt); set('signature', c.signature);
  set('cron-time', c.cronTime); set('sheet-url', pc.sheetUrl || c.sheetUrl);
  set('poll-interval', c.pollInterval); set('send-delay', c.sendDelay);
  set('asset-links', pc.assetLinks || c.assetLinks);
  set('attachment-paths', pc.attachmentPaths || c.attachmentPaths);
}

// â•â•â• NAVIGATION â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const TITLES = {dashboard:'Dashboard',recipients:'Recipients',compose:'Compose Email',send:'Send Campaign',setup:'Setup & Keys',cron:'Schedule',logs:'Send Logs'};
async function setPortal(portal) {
  saveConfig();
  currentPortal = portal;
  localStorage.setItem('iitm_portal', currentPortal);
  document.querySelectorAll('.portal-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById(`portal-${portal}`)?.classList.add('active');
  loadConfig(); loadRecipients(); await loadLogs();
  renderTable(); renderLogs(); updateStats(); populatePreviewDropdown();
  addLog('info', `Switched to ${portalLabel()} portal.`);
}

function showPage(name) {
  document.querySelectorAll('.tab-pane').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const p = document.getElementById('page-'+name);
  if(p){ p.classList.add('active'); }
  document.querySelectorAll('.nav-item').forEach(n=>{
    if(n.getAttribute('onclick')?.includes("'"+name+"'")) n.classList.add('active');
  });
  document.getElementById('topbar-title').textContent = TITLES[name]||name;
  if(name==='compose') populatePreviewDropdown();
  if(name==='send') checkBackendWarning();
  if(name==='logs') loadLogs().then(renderLogs);
}

// â•â•â• CONNECTION TEST â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function testConnection() {
  const url = cfg('backend-url').replace(/\/$/,'');
  const el = document.getElementById('conn-indicator');
  el.className='conn-status conn-idle'; el.textContent='â³ Testing...';
  try {
    const r = await fetch(url+'/api/health', {signal: AbortSignal.timeout(5000)});
    const d = await r.json();
    if(d.ok){ el.className='conn-status conn-ok'; el.textContent='âœ“ Connected'; addLog('ok','Backend connected: '+url); }
    else throw new Error('bad response');
  } catch(e) {
    el.className='conn-status conn-fail'; el.textContent='âœ— Not reachable';
    addLog('err','Backend not reachable: '+e.message);
  }
}

async function testGemini() {
  // Redirected to testOllama
  await testOllama();
}

async function testGmail() {
  const el = document.getElementById('gmail-test-result');
  const url = cfg('backend-url').replace(/\/$/,'');
  if(!url){ el.textContent='âš  Set backend URL first'; el.style.color='var(--warn)'; return; }
  el.textContent='Testing...'; el.style.color='var(--muted)';
  try {
    const r = await fetch(url+'/api/test-gmail', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({email: cfg('sender-email'), appPassword: cfg('gmail-pass')})
    });
    const d = await r.json();
    if(d.ok){ el.textContent='âœ“ Gmail connected!'; el.style.color='var(--accent2)'; }
    else throw new Error(d.message);
  } catch(e) {
    el.textContent='âœ— '+e.message;
    el.style.color='var(--danger)';
  }
}

function checkBackendWarning() {
  const el = document.getElementById('backend-warning');
  el.style.display = cfg('backend-url') ? 'none' : 'flex';
}

// â•â•â• SETTINGS DROPDOWN â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function toggleSettings(e) {
  e.stopPropagation();
  const d = document.getElementById('settings-dropdown');
  d.style.display = d.style.display === 'none' ? 'block' : 'none';
}
function closeSettings() {
  document.getElementById('settings-dropdown').style.display = 'none';
}
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('settings-dropdown');
  const btn = document.getElementById('settings-btn');
  if (dropdown && btn && !dropdown.contains(e.target) && !btn.contains(e.target)) {
    dropdown.style.display = 'none';
  }
});

// â•â•â• OLLAMA â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function fetchOllamaModels() {
  const url = cfg('backend-url').replace(/\/$/,'');
  if(!url){ return; }
  try {
    const r = await fetch(url+'/api/ollama/models', {signal: AbortSignal.timeout(5000)});
    const d = await r.json();
    if(d.ok && d.models.length) {
      const sel = document.getElementById('ollama-model');
      const cur = sel.value;
      sel.innerHTML = d.models.map(m=>`<option value="${m}"${m===cur?' selected':''}>${m}</option>`).join('');
      document.getElementById('ollama-test-result').textContent = `${d.models.length} models found`;
      document.getElementById('ollama-test-result').style.color = 'var(--accent2)';
    }
  } catch(e) {}
}

async function testOllama() {
  const url = cfg('backend-url').replace(/\/$/,'');
  const el = document.getElementById('ollama-test-result');
  if(!url){ el.textContent='âš  Set backend URL first'; el.style.color='var(--warn)'; return; }
  el.textContent='Testing...'; el.style.color='var(--muted)';
  try {
    const r = await fetch(url+'/api/test-ollama', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({model: cfg('ollama-model'), baseUrl: cfg('ollama-url')||'http://localhost:11434'}),
      signal: AbortSignal.timeout(40000)
    });
    const d = await r.json();
    if(d.ok){ el.textContent='âœ“ Ollama OK: '+d.response; el.style.color='var(--accent2)'; }
    else throw new Error(d.error);
  } catch(e) {
    el.textContent='âœ— '+e.message;
    el.style.color='var(--danger)';
  }
}

// â•â•â• OLLAMA GENERATE (replaces Gemini) â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function callGemini(prompt, _keyOverride) {
  const backendUrl = cfg('backend-url').replace(/\/$/,'');
  if(!backendUrl) throw new Error('Backend URL not set â€” click âš™ Settings to configure');
  const r = await fetch(backendUrl+'/api/generate', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({
      prompt,
      model: cfg('ollama-model')||'llama3.2',
      baseUrl: cfg('ollama-url')||'http://localhost:11434'
    })
  });
  const d = await r.json();
  if(!r.ok || d.error) throw new Error(d.error || 'Backend error');
  return d.body;
}

function buildPrompt(r) {
  return cfg('ai-prompt-template')
    .replace(/{{hr_name}}/g, r.hrName||'Hiring Manager')
    .replace(/{{company}}/g, r.company||'')
    .replace(/{{job_post}}/g, r.jobPost||'')
    .replace(/{{job_link}}/g, r.jobLink||'this LinkedIn post')
    .replace(/{{post_context}}/g, r.postContext||'LinkedIn may not expose the full post publicly; rely on the role and link.')
    .replace(/{{asset_links}}/g, linesFrom('asset-links').join(', ') || 'IITM brochure/prospectus links can be shared on request')
    .replace(/{{domain}}/g, r.domain||portalLabel()||'technology');
}

function buildSubject(r) {
  return cfg('subject-template')
    .replace(/{{company}}/g, r.company||'')
    .replace(/{{job_post}}/g, r.jobPost||r.domain||'')
    .replace(/{{hr_name}}/g, r.hrName||'')
    .replace(/{{domain}}/g, r.domain||'');
}

// â•â•â• CSV PARSING â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function parseLine(line) {
  const res=[]; let cur=''; let inQ=false;
  for(let c of line){ if(c==='"'){inQ=!inQ;}else if(c===','&&!inQ){res.push(cur);cur='';}else{cur+=c;} }
  res.push(cur); return res.map(v=>v.trim().replace(/^"|"$/g,''));
}

function parseCSV(text) {
  const lines = text.split('\n').filter(l=>l.trim());
  const items = [];
  const emailRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
  for(const line of lines) {
    const cols = parseLine(line);
    if(cols.length < 3) continue;
    // Skip header rows
    if(cols.some(c=>['email id','email','s no','sno','s.no'].includes(c.toLowerCase()))) continue;
    let email='', company='', jobPost='', jobLink='', sno='';
    // Standard: S No, Date, Company, Job Post, Job Link, Email
    if(cols.length >= 6 && emailRe.test(cols[5])) {
      [sno,,company,jobPost,jobLink,email] = cols;
    } else if(cols.length >= 5 && emailRe.test(cols[4])) {
      [sno,,company,jobPost,email] = cols;
    } else {
      // Find email column
      for(let i=0;i<cols.length;i++) if(emailRe.test(cols[i])){ email=cols[i]; break; }
      company = cols[2]||''; jobPost = cols[3]||''; sno = cols[0]||'';
    }
    if(!email||!emailRe.test(email)) continue;
    email = email.toLowerCase().trim();
    if(recipients.find(r=>r.email===email)) continue;
    const jp=(jobPost||'').toLowerCase();
    const domain = currentPortal === 'es' || jp.includes('embedded') || jp.includes('firmware') || jp.includes('hardware') || jp.includes('iot') || jp.includes('vlsi')
      ? 'Embedded Systems' : 'Data Science';
    items.push({ id:Date.now()+Math.random(), sno, company:company.trim(), jobPost:jobPost.trim(), jobLink:jobLink.trim(), email, domain, portal:currentPortal, status:'pending', hrName:'', postContext:'' });
  }
  return items;
}

function handleCSVUpload(event) {
  const file = event.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const items = parseCSV(e.target.result);
    recipients.push(...items);
    saveRecipients(); renderTable(); updateStats();
    addLog('ok', `Loaded ${items.length} new recipients from ${file.name}`);
    document.getElementById('drop-area').style.display = 'none';
    event.target.value = '';
  };
  reader.readAsText(file);
}
function handleDrop(e) {
  e.preventDefault(); document.getElementById('drop-area').classList.remove('drag');
  const file = e.dataTransfer.files[0];
  if(file) { const dt=new DataTransfer(); dt.items.add(file); handleCSVUpload({target:{files:[file]}}); }
}
function parsePastedData() {
  const items = parseCSV(document.getElementById('paste-area').value);
  if(!items.length){ alert('No valid rows found. Format: S No, Date, Company, Job Post, Job Link, Email'); return; }
  recipients.push(...items); saveRecipients(); renderTable(); updateStats();
  addLog('ok', `Parsed ${items.length} recipients`);
  document.getElementById('drop-area').style.display = 'none';
}
function clearRecipients() {
  if(!confirm('Clear all recipients?')) return;
  recipients=[]; saveRecipients(); renderTable(); updateStats();
}

async function enrichRecipients() {
  const backendUrl = cfg('backend-url').replace(/\/$/,'');
  if(!backendUrl){ alert('Set Backend URL in Settings first.'); return; }
  const targets = recipients.filter(r => !r.company || r.company.length <= 4 || !r.postContext);
  if(!targets.length){ addLog('info','All recipients already have company/context data.'); return; }
  addLog('info', `Resolving ${targets.length} companies for ${portalLabel()}...`);
  for(const r of targets) {
    try {
      const res = await fetch(backendUrl+'/api/enrich-recipient', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({email:r.email, company:r.company, domain:r.email, jobLink:r.jobLink})
      });
      const d = await res.json();
      if(d.ok) {
        if(d.company?.company) r.company = d.company.company;
        if(d.postContext?.title || d.postContext?.description) {
          r.postContext = [d.postContext.title, d.postContext.description].filter(Boolean).join(' - ');
        }
        addLog('ok', `${r.email} -> ${r.company}`);
      }
    } catch(e) {
      addLog('err', `Resolve failed for ${r.email}: ${e.message}`);
    }
  }
  saveRecipients(); renderTable(); updateStats(); populatePreviewDropdown();
}

// â•â•â• TABLE RENDER â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function statusBadge(s) {
  const map={pending:'status-pending',sent:'status-sent',failed:'status-failed'};
  const ico={pending:'â³',sent:'âœ“',failed:'âœ—'};
  return `<span class="status-badge ${map[s]||'status-pending'}">${ico[s]||'â³'} ${s||'pending'}</span>`;
}

function renderTable() {
  const tbody=document.getElementById('recipients-tbody');
  const wrap=document.getElementById('recipients-table-wrap');
  const noRec=document.getElementById('no-recipients');
  const dropArea=document.getElementById('drop-area');
  document.getElementById('rec-count').textContent = recipients.length;

  if(!recipients.length){
    wrap.style.display='none'; noRec.style.display='block';
    dropArea.style.display='block'; return;
  }
  wrap.style.display='block'; noRec.style.display='none';

  // Domain filter chips
  const domains=[...new Set(recipients.map(r=>r.domain))];
  document.getElementById('domain-filter').innerHTML =
    `<span style="font-size:12px;color:var(--muted2);padding:4px 6px;cursor:pointer;border-radius:20px;border:1px solid var(--border)" onclick="filterDomain('all',this)">All</span>` +
    domains.map(d=>`<span style="font-size:12px;color:var(--muted);padding:4px 10px;cursor:pointer;border-radius:20px;border:1px solid var(--border)" onclick="filterDomain('${d}',this)">${d}</span>`).join('');

  tbody.innerHTML = recipients.map((r,i)=>`
    <tr id="row-${i}">
      <td><input type="checkbox" class="rcheck" data-i="${i}" checked></td>
      <td style="color:var(--muted);font-family:var(--font-mono);font-size:11px">${r.sno||i+1}</td>
      <td style="font-weight:500;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.company||'â€”'}</td>
      <td><span class="job-role">${r.jobPost||'â€”'}</span></td>
      <td class="email-cell">${r.email}</td>
      <td style="font-size:11px;color:var(--muted)">${r.domain}</td>
      <td>${statusBadge(r.status)}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" onclick="previewSingle(${i})">ðŸ‘ Preview</button>
          <button class="btn btn-danger btn-sm" onclick="removeR(${i})">âœ•</button>
        </div>
      </td>
    </tr>`).join('');
}

function filterDomain(domain, el) {
  document.querySelectorAll('#domain-filter span').forEach(s=>s.style.color='var(--muted)');
  el.style.color='var(--accent)';
  document.querySelectorAll('#recipients-tbody tr').forEach((row,i)=>{
    row.style.display=(domain==='all'||recipients[i]?.domain===domain)?'':'none';
  });
}
function toggleSelectAll(checked) { document.querySelectorAll('.rcheck').forEach(cb=>cb.checked=checked); }
function removeR(i){ recipients.splice(i,1); saveRecipients(); renderTable(); updateStats(); }

// â•â•â• STATS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function updateStats() {
  const t=recipients.length, s=recipients.filter(r=>r.status==='sent').length,
        p=recipients.filter(r=>r.status==='pending').length, f=recipients.filter(r=>r.status==='failed').length;
  ['total','sent','pending','failed'].forEach((k,i)=>{ const el=document.getElementById('stat-'+k); if(el) el.textContent=[t,s,p,f][i]; });
  document.getElementById('top-sent').textContent=s+' sent';
  document.getElementById('top-pending').textContent=p+' pending';
  document.getElementById('top-failed').textContent=f+' failed';
  renderDashRecent();
}

// â•â•â• PREVIEW â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function populatePreviewDropdown() {
  const sel=document.getElementById('preview-recipient');
  sel.innerHTML='<option value="">-- Select recipient --</option>'+
    recipients.map((r,i)=>`<option value="${i}">${r.company} â€” ${r.email}</option>`).join('');
}

async function generatePreview() {
  const idx=parseInt(document.getElementById('preview-recipient').value);
  if(isNaN(idx)||!recipients[idx]) return;
  const r=recipients[idx];
  document.getElementById('pv-to').textContent=r.email;
  document.getElementById('pv-subject').textContent=buildSubject(r);
  document.getElementById('pv-body').innerHTML='<span class="spinner"></span> Generating with Ollama...';
  document.getElementById('pv-char-count').textContent='';
  try {
    const body=await callGemini(buildPrompt(r));
    const full=body+(cfg('signature')?'\n\n'+cfg('signature'):'');
    document.getElementById('pv-body').textContent=full;
    document.getElementById('pv-char-count').textContent=`${full.split(/\s+/).length} words Â· ${full.length} chars`;
  } catch(e) {
    document.getElementById('pv-body').textContent='Error: '+e.message;
  }
}

async function previewSingle(idx) {
  const r=recipients[idx]; if(!r) return;
  previewIdx=idx;
  document.getElementById('modal-to').textContent=r.email;
  document.getElementById('modal-subject').textContent=buildSubject(r);
  document.getElementById('modal-desc').textContent=`${r.company} Â· ${r.jobPost}`;
  document.getElementById('modal-body').innerHTML='<span class="spinner"></span> Generating personalized email with Ollama...';
  document.getElementById('modal-char-count').textContent='';
  document.getElementById('modal-send-btn').disabled=true;
  document.getElementById('preview-modal').classList.add('open');
  try {
    const body=await callGemini(buildPrompt(r));
    const full=body+(cfg('signature')?'\n\n'+cfg('signature'):'');
    r._body=full;
    document.getElementById('modal-body').textContent=full;
    document.getElementById('modal-char-count').textContent=`${full.split(/\s+/).length} words Â· ${full.length} chars`;
    document.getElementById('modal-send-btn').disabled=false;
  } catch(e) {
    document.getElementById('modal-body').textContent='Error: '+e.message;
  }
}

async function sendSingleEmail() {
  if(previewIdx===null) return;
  const r=recipients[previewIdx];
  const body=r._body||document.getElementById('modal-body').textContent;
  const btn=document.getElementById('modal-send-btn');
  btn.disabled=true; btn.textContent='Sending...';
  try {
    await doSend(r, buildSubject(r), body);
    r.status='sent'; saveRecipients(); renderTable(); updateStats();
    addLogEntry({time:new Date().toLocaleTimeString(), email:r.email, company:r.company, job:r.jobPost, status:'sent', msg:'OK'});
    closeModal();
  } catch(e) {
    alert('Send failed: '+e.message);
    btn.disabled=false; btn.textContent='Send this email';
  }
}

function closeModal(){ document.getElementById('preview-modal').classList.remove('open'); }

// â•â•â• ACTUAL EMAIL SEND â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function doSend(recipient, subject, body) {
  const backendUrl=cfg('backend-url').replace(/\/$/,'');
  if(!backendUrl) throw new Error('Backend URL not configured. See Setup page.');
  const response=await fetch(backendUrl+'/api/send', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({
      to: recipient.email, subject, body,
      portal: currentPortal,
      company: recipient.company,
      jobPost: recipient.jobPost,
      jobLink: recipient.jobLink,
      links: linesFrom('asset-links'),
      attachments: linesFrom('attachment-paths'),
      fromName: cfg('from-name'), fromEmail: cfg('sender-email'),
      appPassword: cfg('gmail-pass')
    })
  });
  const d=await response.json();
  await loadLogs();
  if(!response.ok||d.error) throw new Error(d.error||'Send failed');
  return d;
}

// â•â•â• CAMPAIGN â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function startCampaign() {
  if(isSending) return;
  if(!cfg('backend-url')){ alert('Set Backend URL in âš™ Settings first'); return; }
  const domain=cfg('send-domain'), filter=document.getElementById('send-filter').value;
  const delay=Math.max(2,parseInt(cfg('send-delay'))||4)*1000;
  let targets=recipients.filter(r=>{
    if(domain!=='all'&&r.domain!==domain) return false;
    if(filter==='pending'&&r.status!=='pending') return false;
    if(filter==='failed'&&r.status!=='failed') return false;
    return true;
  });
  // Only send to checked rows
  const checked=new Set([...document.querySelectorAll('.rcheck:checked')].map(cb=>parseInt(cb.dataset.i)));
  if(checked.size>0) targets=targets.filter(r=>checked.has(recipients.indexOf(r)));
  if(!targets.length){ alert('No matching recipients to send.'); return; }

  isSending=true; stopFlag=false;
  document.getElementById('start-btn').disabled=true;
  document.getElementById('stop-btn').style.display='';
  document.getElementById('progress-section').style.display='block';
  document.getElementById('send-log').innerHTML='';

  let sent=0,failed=0;
  for(let i=0;i<targets.length;i++){
    if(stopFlag){ addSLog('warn','â¹ Stopped by user'); break; }
    const r=targets[i];
    const pct=Math.round((i/targets.length)*100);
    document.getElementById('progress-fill').style.width=pct+'%';
    document.getElementById('progress-pct').textContent=pct+'%';
    document.getElementById('progress-label').textContent=`[${i+1}/${targets.length}] ${r.company} â†’ ${r.email}`;
    document.getElementById('ps-remaining').textContent=`${targets.length-i} remaining`;
    addSLog('info',`[${i+1}/${targets.length}] Generating for ${r.company}...`);
    try {
      const body=await callGemini(buildPrompt(r));
      const full=body+(cfg('signature')?'\n\n'+cfg('signature'):'');
      addSLog('info',`  âœ¦ Generated (${full.split(/\s+/).length} words). Sending to ${r.email}...`);
      await doSend(r, buildSubject(r), full);
      r.status='sent'; sent++;
      document.getElementById('ps-sent').textContent=sent+' sent';
      addSLog('ok',`  âœ“ Sent!`);
      addLogEntry({time:new Date().toLocaleTimeString(),email:r.email,company:r.company,job:r.jobPost,status:'sent',msg:'OK'});
    } catch(e) {
      r.status='failed'; failed++;
      document.getElementById('ps-failed').textContent=failed+' failed';
      addSLog('err',`  âœ— ${e.message}`);
      addLogEntry({time:new Date().toLocaleTimeString(),email:r.email,company:r.company,job:r.jobPost,status:'failed',msg:e.message});
    }
    saveRecipients(); updateStats(); renderTable();
    if(i<targets.length-1&&!stopFlag){
      addSLog('info',`  â± Waiting ${delay/1000}s...`);
      await new Promise(res=>setTimeout(res,delay));
    }
  }
  document.getElementById('progress-fill').style.width='100%';
  document.getElementById('progress-pct').textContent='100%';
  document.getElementById('progress-label').textContent=`Done â€” ${sent} sent, ${failed} failed`;
  addSLog('ok',`\nâœ… Campaign complete: ${sent} sent, ${failed} failed`);
  addLog('ok',`Campaign done: ${sent} sent, ${failed} failed`);
  isSending=false;
  document.getElementById('start-btn').disabled=false;
  document.getElementById('stop-btn').style.display='none';
}
function stopCampaign(){ stopFlag=true; }

// â•â•â• LOGS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function addLogEntry(obj) {
  logs.unshift(obj); saveLogs(); renderLogs();
}
function renderLogs() {
  const tbody=document.getElementById('logs-tbody');
  if(!logs.length){ tbody.innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:40px">No logs yet</td></tr>'; return; }
  tbody.innerHTML=logs.slice(0,300).map(l=>`
    <tr>
      <td style="font-family:var(--font-mono);font-size:11px;color:var(--muted);white-space:nowrap">${l.created_at||l.time}</td>
      <td style="font-size:11px;color:var(--accent)">${(l.portal||currentPortal).toUpperCase()}</td>
      <td class="email-cell">${l.email}</td>
      <td style="font-size:12px">${l.company}</td>
      <td><span class="job-role">${l.job_post||l.job}</span></td>
      <td>${statusBadge(l.status)}</td>
      <td style="font-size:12px;color:var(--muted)">${l.message||l.msg}</td>
    </tr>`).join('');
}
async function clearLogs(){
  if(!confirm('Clear logs for this portal?')) return;
  const backendUrl=cfg('backend-url').replace(/\/$/,'');
  if(backendUrl) {
    await fetch(`${backendUrl}/api/logs?portal=${currentPortal}`, {method:'DELETE'});
  }
  logs=[]; saveLogs(); renderLogs();
}

// â•â•â• CRON â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function toggleCron() {
  cronOn=!cronOn;
  document.getElementById('cron-toggle').classList.toggle('on',cronOn);
  if(cronOn){
    const t=cfg('cron-time');
    document.getElementById('cron-status').innerHTML=`Cron <strong style="color:var(--accent)">enabled</strong> â€” daily at ${t} IST`;
    if(cronTimer) clearInterval(cronTimer);
    cronTimer=setInterval(()=>{
      if(!cronOn) return;
      const now=new Date(), [h,m]=cfg('cron-time').split(':').map(Number);
      const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const checked=[...document.querySelectorAll('.day-check:checked')].map(c=>c.value);
      if(now.getHours()===h&&now.getMinutes()===m&&checked.includes(days[now.getDay()])){
        addLog('ok','â° Cron triggered'); startCampaign();
      }
    },60000);
  } else {
    if(cronTimer){clearInterval(cronTimer);cronTimer=null;}
    document.getElementById('cron-status').innerHTML=`Cron <strong style="color:var(--danger)">disabled</strong>`;
  }
}
function togglePoll(){
  pollOn=!pollOn;
  document.getElementById('poll-toggle').classList.toggle('on',pollOn);
  if(pollOn){ const m=parseInt(cfg('poll-interval'))||30; pollTimer=setInterval(fetchSheetNow,m*60000); }
  else { if(pollTimer){clearInterval(pollTimer);pollTimer=null;} }
}
async function fetchSheetNow(){
  const url=cfg('sheet-url'); if(!url){alert('Set sheet URL first'); return;}
  addLog('info','Fetching sheet...');
  try {
    const r=await fetch(url); const text=await r.text();
    const items=parseCSV(text);
    if(items.length){ recipients.push(...items); saveRecipients(); renderTable(); updateStats(); addLog('ok',`${items.length} new emails from sheet`); }
    else addLog('info','No new emails in sheet');
  } catch(e){ addLog('err','Sheet fetch failed: '+e.message); }
}

// â•â•â• PERSISTENCE â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function saveRecipients(){ localStorage.setItem(storageKey('iitm_rec'), JSON.stringify(recipients)); }
function saveLogs(){ localStorage.setItem(storageKey('iitm_logs'), JSON.stringify(logs.slice(0,500))); }
function loadRecipients(){ try{ const r=JSON.parse(localStorage.getItem(storageKey('iitm_rec'))||'[]'); recipients=r; }catch{recipients=[];} }
async function loadLogs(){
  const backendUrl=cfg('backend-url').replace(/\/$/,'');
  if(backendUrl) {
    try {
      const r = await fetch(`${backendUrl}/api/logs?portal=${currentPortal}&limit=300`);
      const d = await r.json();
      if(d.ok){ logs=d.logs; saveLogs(); return; }
    } catch(e) {}
  }
  try{ logs=JSON.parse(localStorage.getItem(storageKey('iitm_logs'))||'[]'); }catch{logs=[];}
}

async function saveAssets() {
  const backendUrl=cfg('backend-url').replace(/\/$/,'');
  if(!backendUrl) return;
  try {
    await fetch(`${backendUrl}/api/assets/${currentPortal}`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({links:cfg('asset-links'), attachmentPaths:cfg('attachment-paths')})
    });
  } catch(e) {}
}

// â•â•â• INIT â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
document.addEventListener('DOMContentLoaded',async ()=>{
  document.getElementById(`portal-${currentPortal}`)?.classList.add('active');
  document.querySelectorAll('.portal-btn').forEach(b=>{ if(b.id !== `portal-${currentPortal}`) b.classList.remove('active'); });
  loadConfig(); loadRecipients(); await loadLogs();
  renderTable(); renderLogs(); updateStats(); renderDashRecent();
  addLog('info','App ready.');
  if(cfg('backend-url')) fetchOllamaModels();
  // Close modal on backdrop click
  document.getElementById('preview-modal').addEventListener('click',e=>{ if(e.target===e.currentTarget) closeModal(); });
});

function renderDashRecent() {
  const el = document.getElementById('dash-recent-table');
  if(!el) return;
  if(!recipients.length){
    el.innerHTML='<div style="padding:30px;text-align:center;color:var(--muted);font-size:13px">No recipients yet. <a onclick="showPage(\'recipients\')" style="color:var(--accent);cursor:pointer">Upload CSV â†’</a></div>';
    return;
  }
  const recent = recipients.slice(0,8);
  el.innerHTML=`<table style="width:100%">
    <thead><tr style="background:var(--surface2)">
      <th style="padding:8px 14px;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;text-align:left">Company</th>
      <th style="padding:8px 14px;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;text-align:left">Email</th>
      <th style="padding:8px 14px;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;text-align:left">Status</th>
    </tr></thead>
    <tbody>${recent.map(r=>`<tr style="border-top:1px solid var(--border)">
      <td style="padding:9px 14px;font-size:13px;font-weight:500">${r.company||'â€”'}</td>
      <td style="padding:9px 14px;font-family:var(--font-mono);font-size:11px;color:var(--accent2)">${r.email}</td>
      <td style="padding:9px 14px">${statusBadge(r.status)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function addLog(type, msg) {
  const el = document.getElementById('dashboard-log');
  if (!el) return;

  const time = new Date().toLocaleTimeString();
  const div = document.createElement('div');
  div.className = 'log-entry';
  div.innerHTML = `<span class="log-time">${time}</span><span class="log-${type}">${msg}</span>`;
  el.prepend(div);
}

function addSLog(type, msg) {
  const el = document.getElementById('send-log');
  if (!el) return;

  const time = new Date().toLocaleTimeString();
  const div = document.createElement('div');
  div.className = 'log-entry';
  div.innerHTML = `<span class="log-time">${time}</span><span class="log-${type}">${msg}</span>`;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}
