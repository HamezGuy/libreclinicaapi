const https = require('https');

function req(opts, body) {
  return new Promise((resolve, reject) => {
    const r = https.request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

function get(path, token) {
  return req({ hostname: 'api.accuratrials.com', path, method: 'GET', headers: { 'Authorization': 'Bearer ' + token } });
}

async function main() {
  // Login as admin
  const body = JSON.stringify({ username: 'jamesgui333', password: 'Welcome2025!' });
  const res = await req({
    hostname: 'api.accuratrials.com', path: '/api/auth/login', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  const token = res.accessToken;
  if (!token) { console.log('Login failed'); return; }
  console.log('Logged in');

  // Get ALL forms (not study-filtered)
  const forms = await get('/api/forms', token);
  const formList = forms.data || forms;
  console.log('Total forms:', Array.isArray(formList) ? formList.length : 'not array');

  if (Array.isArray(formList)) {
    formList.forEach(f => {
      console.log('  CRF ' + (f.crfId || f.id) + ': ' + f.name);
    });
    
    const eligForms = formList.filter(f => f.name && f.name.toLowerCase().includes('eligib'));
    if (eligForms.length > 0) {
      const crfId = eligForms[0].crfId || eligForms[0].id;
      console.log('\nFetching Eligibility form CRF ID:', crfId);
      
      const form = await get('/api/forms/' + crfId, token);
      const formData = form.data || form;
      if (formData?.fields) {
        console.log('\n=== FIELDS (' + formData.fields.length + ') ===\n');
        formData.fields.forEach((f, i) => {
          const name = f.name || '(none)';
          console.log(
            String(i+1).padStart(2) +
            ' | DOT=' + (name.includes('.') ? 'YES' : 'no ') +
            ' | type=' + (f.type || '?').padEnd(10) +
            ' | key="' + name + '"' +
            ' | label="' + (f.label || '').substring(0, 60) + '"'
          );
        });
      }
    }
  }

  // Also try: get all studies user can see
  const studies = await get('/api/studies', token);
  const studyList = studies.data || studies;
  console.log('\nStudies visible:', Array.isArray(studyList) ? studyList.map(s => (s.studyId||s.id) + ':' + s.name) : 'none');
  
  // Try to get the form by searching all studies
  if (Array.isArray(studyList)) {
    for (const s of studyList) {
      const sid = s.studyId || s.id;
      const sf = await get('/api/forms/by-study?studyId=' + sid, token);
      const sfl = sf.data || sf;
      if (Array.isArray(sfl)) {
        const elig = sfl.find(f => f.name && f.name.includes('Eligibility'));
        if (elig) {
          console.log('\nFound Eligibility in study ' + sid + ':', elig.crfId || elig.id, elig.name);
          const form = await get('/api/forms/' + (elig.crfId || elig.id), token);
          const fd = form.data || form;
          if (fd?.fields) {
            console.log('\n=== FIELDS (' + fd.fields.length + ') ===\n');
            fd.fields.forEach((f, i) => {
              const name = f.name || '(none)';
              console.log(
                String(i+1).padStart(2) +
                ' | DOT=' + (name.includes('.') ? 'YES' : 'no ') +
                ' | type=' + (f.type || '?').padEnd(10) +
                ' | key="' + name + '"' +
                ' | label="' + (f.label || '').substring(0, 60) + '"'
              );
            });
          }
          break;
        }
      }
    }
  }
}

main().catch(e => console.error('Error:', e.message));
