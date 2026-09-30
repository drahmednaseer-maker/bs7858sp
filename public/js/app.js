/* Security Projects – onboarding portal client script (no dependencies). */
(function () {
  'use strict';
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const CSRF = ($('meta[name="csrf-token"]') || {}).content;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtMonth = (ym) => { if (!ym) return ''; const [y, m] = ym.split('-'); return MONTHS[Number(m) - 1] + ' ' + y; };
  const hexId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');

  // ---------- Nav ----------
  const menuBtn = $('[data-menu]');
  if (menuBtn) menuBtn.addEventListener('click', () => $('#nav').classList.toggle('open'));
  const navSel = $('[data-nav-select]');
  if (navSel) navSel.addEventListener('change', () => { location.href = navSel.value; });
  document.addEventListener('submit', (e) => {
    $$('[data-sig]', e.target).forEach((h) => { if (h._acceptPending) h._acceptPending(); });
  }, true);
  document.addEventListener('submit', (e) => {
    const msg = e.target.getAttribute('data-confirm');
    if (msg && !confirm(msg)) e.preventDefault();
  });
  // Month + year pickers: keep the hidden YYYY-MM value (used by classic form posts) in step.
  const monthValue = (wrap) => {
    const m = $('[data-mp="m"]', wrap).value; const y = $('[data-mp="y"]', wrap).value;
    return m && y ? y + '-' + m : '';
  };
  document.addEventListener('change', (e) => {
    const wrap = e.target.closest('[data-month-pick]');
    if (!wrap) return;
    const hidden = $('[data-mp="v"]', wrap);
    if (hidden) hidden.value = monthValue(wrap);
  });

  // On phones, hide the sticky save bar while the on-screen keyboard is open so it can't cover the field.
  const small = window.matchMedia('(max-width: 760px)');
  document.addEventListener('focusin', (e) => {
    if (small.matches && e.target.matches('input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea')) document.body.classList.add('kb-open');
  });
  document.addEventListener('focusout', () => setTimeout(() => {
    const a = document.activeElement;
    if (!a || !a.matches('input, textarea')) document.body.classList.remove('kb-open');
  }, 50));

  $$('[data-copy]').forEach((b) => b.addEventListener('click', () => {
    navigator.clipboard.writeText(b.getAttribute('data-copy')).then(() => { const t = b.textContent; b.textContent = 'Copied'; setTimeout(() => { b.textContent = t; }, 1500); });
  }));

  // ---------- Signature pad ----------
  function initSig(host) {
    if (host._init) return;
    host._init = true;
    const disabled = host.hasAttribute('data-disabled');
    const hiddenName = host.getAttribute('data-input');
    let hidden = null;
    if (hiddenName) { hidden = document.createElement('input'); hidden.type = 'hidden'; hidden.name = hiddenName; host.after(hidden); }
    let value = null;
    try { value = host.getAttribute('data-value') ? JSON.parse(host.getAttribute('data-value')) : null; } catch (e) { value = null; }
    host._sig = value;

    const set = (v) => { host._sig = v; if (hidden) hidden.value = v ? v.image : ''; host.dispatchEvent(new Event('change', { bubbles: true })); };

    function showDone() {
      host.innerHTML = '';
      const box = document.createElement('div');
      box.className = 'sig-done';
      const when = host._sig.signedAt ? new Date(host._sig.signedAt).toLocaleString('en-GB') : 'just now';
      box.innerHTML = '<img alt="Your signature"><div class="meta"><b>Signed electronically</b><br>' + when + '</div>';
      box.querySelector('img').src = host._sig.image;
      if (!disabled) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn btn-sm'; b.textContent = 'Sign again';
        b.addEventListener('click', () => { set(null); showPad(); });
        box.appendChild(b);
      }
      host.appendChild(box);
    }

    function showPad() {
      host.innerHTML = '<div class="sig-box"><canvas></canvas><span class="sig-hint">Sign with your finger, stylus or mouse</span><span class="sig-x">✕</span><span class="sig-line"></span>' +
        '<div class="sig-tools"><span>By signing you agree this is your legal electronic signature.</span><span class="btn-row"><button type="button" class="btn btn-sm" data-clear>Clear</button><button type="button" class="btn btn-sm btn-dark" data-accept>Use signature</button></span></div></div>';
      const canvas = $('canvas', host);
      const ctx = canvas.getContext('2d');
      const hint = $('.sig-hint', host);
      let drawing = false; let has = false; let last = null;
      function size() {
        const r = canvas.getBoundingClientRect();
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        canvas.width = r.width * dpr; canvas.height = r.height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b1f4b';
      }
      size();
      // Rotating the phone changes the canvas width: rescale what's been drawn instead of distorting it.
      let lastW = canvas.getBoundingClientRect().width;
      const onResize = () => {
        if (!canvas.isConnected) { window.removeEventListener('resize', onResize); return; }
        const w = canvas.getBoundingClientRect().width;
        if (!w || Math.abs(w - lastW) < 2) return;
        const snap = has ? canvas.toDataURL() : null;
        const oldW = lastW; lastW = w;
        size();
        if (snap) {
          // Keep the aspect ratio: shrink uniformly if the pad got narrower, otherwise redraw at the same size.
          const k = Math.min(1, w / oldW);
          const h = canvas.getBoundingClientRect().height;
          const im = new Image();
          im.onload = () => ctx.drawImage(im, 0, 0, oldW * k, h * k);
          im.src = snap;
        }
      };
      window.addEventListener('resize', onResize);
      const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); canvas.setPointerCapture(e.pointerId); drawing = true; last = pos(e); hint.style.display = 'none'; ctx.beginPath(); ctx.arc(last.x, last.y, 1.1, 0, Math.PI * 2); ctx.fillStyle = '#0b1f4b'; ctx.fill(); has = true; });
      canvas.addEventListener('pointermove', (e) => {
        if (!drawing) return;
        const p = pos(e);
        ctx.beginPath(); ctx.moveTo(last.x, last.y);
        const mx = (last.x + p.x) / 2; const my = (last.y + p.y) / 2;
        ctx.quadraticCurveTo(last.x, last.y, mx, my); ctx.lineTo(p.x, p.y); ctx.stroke();
        last = p; has = true;
      });
      const end = () => { drawing = false; };
      canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end); canvas.addEventListener('pointerleave', end);
      $('[data-clear]', host).addEventListener('click', () => { ctx.clearRect(0, 0, canvas.width, canvas.height); has = false; hint.style.display = ''; });
      // Count a drawn-but-not-confirmed signature when the form is saved/submitted.
      host._acceptPending = () => { if (has && !host._sig) { set({ image: trim(canvas) }); showDone(); } };
      $('[data-accept]', host).addEventListener('click', () => {
        if (!has) { alert('Please draw your signature first.'); return; }
        // Crop to content on a white background for a clean PNG.
        const out = trim(canvas);
        set({ image: out });
        showDone();
      });
    }

    function trim(c) {
      const w = c.width; const h = c.height;
      const data = c.getContext('2d').getImageData(0, 0, w, h).data;
      let x0 = w, y0 = h, x1 = 0, y1 = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const pad = 12;
      x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w, x1 + pad); y1 = Math.min(h, y1 + pad);
      const scale = Math.min(1, 600 / (x1 - x0));
      const o = document.createElement('canvas');
      o.width = Math.max(1, Math.round((x1 - x0) * scale)); o.height = Math.max(1, Math.round((y1 - y0) * scale));
      const octx = o.getContext('2d');
      octx.fillStyle = '#fff'; octx.fillRect(0, 0, o.width, o.height);
      octx.drawImage(c, x0, y0, x1 - x0, y1 - y0, 0, 0, o.width, o.height);
      return o.toDataURL('image/png');
    }

    if (value && value.image) { if (hidden) hidden.value = value.image; showDone(); } else if (!disabled) showPad();
    else host.innerHTML = '<span class="muted">Not signed</span>';
  }
  $$('[data-sig]').forEach(initSig);

  // ---------- File uploads ----------
  // Phone photos: bake in the EXIF rotation (so ID scans aren't sideways in the PDF) and cap the size.
  // Small PNG screenshots are left untouched; anything that can't be decoded is uploaded as-is.
  async function shrink(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    if (file.type === 'image/png' && file.size < 1.5 * 1024 * 1024) return file;
    try {
      let bmp;
      try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { bmp = await createImageBitmap(file); }
      const s = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86));
      return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
    } catch (e) { return file; }
  }

  function fileItem(doc, disabled) {
    const li = document.createElement('li');
    li.dataset.doc = doc.id;
    const isImg = /^image\/(jpeg|png|webp|gif)$/.test(doc.mime);
    li.innerHTML = (isImg ? '<img class="thumb" alt="">' : '<span class="thumb">' + (doc.mime === 'application/pdf' ? 'PDF' : 'IMG') + '</span>') +
      '<span class="name"><a target="_blank" rel="noopener"></a></span><span class="size">' + (doc.size / 1048576).toFixed(1) + ' MB</span>' + (disabled ? '' : '<button type="button" data-del>Remove</button>');
    if (isImg) li.querySelector('img').src = '/apply/file/' + doc.id;
    const a = li.querySelector('a'); a.href = '/apply/file/' + doc.id; a.textContent = doc.name;
    return li;
  }

  function uploadOne(host, file) {
    return new Promise((resolve) => {
      const list = $('.file-list', host);
      const li = document.createElement('li');
      li.innerHTML = '<span class="thumb">…</span><span class="name"></span><span class="size" style="min-width:90px"><span class="progress-line"><i></i></span></span>';
      li.querySelector('.name').textContent = file.name;
      list.appendChild(li);
      const fd = new FormData();
      fd.append('field_key', host.dataset.fieldKey);
      fd.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/apply/upload');
      xhr.setRequestHeader('X-CSRF-Token', CSRF);
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) li.querySelector('i').style.width = Math.round((e.loaded / e.total) * 100) + '%'; };
      xhr.onload = () => {
        let res = {};
        try { res = JSON.parse(xhr.responseText); } catch (e) { res = { error: 'Upload failed.' }; }
        if (xhr.status === 200) { li.replaceWith(fileItem(res, false)); clearErr(host.closest('[data-field]')); }
        else { li.remove(); alert(res.error || 'Upload failed.'); }
        resolve();
      };
      xhr.onerror = () => { li.remove(); alert('Upload failed – please check your connection.'); resolve(); };
      xhr.send(fd);
    });
  }

  function initFiles(host) {
    if (host._init || host.hasAttribute('data-disabled')) return;
    host._init = true;
    const drop = $('.drop', host);
    const handle = async (fileList) => { for (const f of Array.from(fileList)) await uploadOne(host, await shrink(f)); };
    $$('input[type=file]', host).forEach((input) => input.addEventListener('change', () => {
      const picked = Array.from(input.files); // copy first – Safari empties the live FileList when value is cleared
      input.value = '';
      handle(picked);
    }));
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => handle(e.dataTransfer.files));
    host.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-del]');
      if (!b) return;
      const li = b.closest('li');
      if (!confirm('Remove this file?')) return;
      const r = await fetch('/apply/upload/' + li.dataset.doc + '/delete', { method: 'POST', headers: { 'X-CSRF-Token': CSRF, Accept: 'application/json' } });
      if (r.ok) li.remove(); else alert('Could not remove the file.');
    });
  }
  $$('[data-files]').forEach(initFiles);

  // ---------- Settings: template field chips, confirm buttons, signature image upload ----------
  let lastTpl = null;
  document.addEventListener('focusin', (e) => { if (e.target.matches('[data-tpl-text]')) lastTpl = e.target; });
  $$('[data-insert]').forEach((b) => b.addEventListener('click', () => {
    const ta = (b.closest('form') && $('[data-tpl-text]', b.closest('form'))) || lastTpl || $('[data-tpl-text]');
    if (!ta) return;
    const s = ta.selectionStart ?? ta.value.length; const e2 = ta.selectionEnd ?? s;
    ta.value = ta.value.slice(0, s) + b.dataset.insert + ta.value.slice(e2);
    ta.focus(); ta.selectionStart = ta.selectionEnd = s + b.dataset.insert.length;
  }));
  $$('[data-confirm-click]').forEach((b) => b.addEventListener('click', (e) => { if (!confirm(b.dataset.confirmClick)) e.preventDefault(); }));
  $$('[data-sig-upload]').forEach((input) => input.addEventListener('change', async () => {
    const f = input.files[0]; input.value = '';
    if (!f) return;
    try {
      // Downscale and flatten onto white so the signature stays small and prints cleanly.
      const bmp = await createImageBitmap(f);
      const s = Math.min(1, 700 / bmp.width, 240 / bmp.height);
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height);
      const url = c.toDataURL('image/png');
      const form = input.closest('form');
      $('[data-sig-upload-value]', form).value = url;
      const pv = $('[data-sig-upload-preview]', form); pv.src = url; pv.classList.remove('hidden');
    } catch (err) { alert('That image could not be read – please use a PNG or JPG.'); }
  }));

  // ---------- Screening check evidence: paste / drop / browse ----------
  // Staff screenshot a result (Win+Shift+S / PrtScn), click the check, press Ctrl+V. Files are previewed
  // (removable) and only uploaded when "Save check" is pressed; the server names and attributes them.
  const EV_TYPES = /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/;
  let activeCheckForm = null;
  const ukStamp = () => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).map((x) => [x.type, x.value]));
    return p.year + '-' + p.month + '-' + p.day + '_' + p.hour + p.minute;
  };

  function initCheckForm(cform) {
    const zone = $('[data-paste-zone]', cform);
    if (!zone) return;
    const staged = [];
    const box = $('[data-staged]', cform); const list = $('[data-staged-list]', cform); const note = $('[data-staged-note]', cform);
    const extOf = (f) => (f.type === 'application/pdf' ? 'pdf' : f.type === 'image/jpeg' ? 'jpg' : f.type.split('/')[1]);

    function render() {
      list.innerHTML = '';
      const stamp = ukStamp(); const used = {};
      staged.forEach((f, i) => {
        let name = cform.dataset.evPrefix + '_' + stamp + '.' + extOf(f);
        used[name] = (used[name] || 0) + 1;
        if (used[name] > 1) name = name.replace(/(\.\w+)$/, '_' + used[name] + '$1');
        const li = document.createElement('li');
        li.innerHTML = '<a class="ev-thumb" target="_blank" rel="noopener"></a><div class="ev-meta"><b></b><span class="small muted"></span></div><button type="button" class="btn btn-sm btn-ghost ev-del">Remove</button>';
        const th = $('.ev-thumb', li);
        if (!f._url) f._url = URL.createObjectURL(f);
        th.href = f._url;
        if (f.type.startsWith('image/')) { const im = document.createElement('img'); im.src = f._url; im.alt = 'Preview'; th.appendChild(im); } else th.innerHTML = '<span>PDF</span>';
        $('b', li).textContent = name;
        $('.ev-meta span', li).textContent = (f.size / 1024).toFixed(0) + ' KB · not saved yet';
        $('button', li).addEventListener('click', () => { URL.revokeObjectURL(f._url); staged.splice(i, 1); render(); zone.focus(); });
        list.appendChild(li);
      });
      box.classList.toggle('hidden', !staged.length);
      note.textContent = staged.length ? staged.length + ' file' + (staged.length > 1 ? 's' : '') + ' ready – check the preview, then press "Save check". Final names are set when saved.' : '';
      zone.classList.toggle('has-files', !!staged.length);
    }

    function add(files, source) {
      let rejected = 0;
      Array.from(files).forEach((f) => {
        if (!EV_TYPES.test(f.type)) { rejected++; return; }
        if (f.size > 15 * 1024 * 1024) { alert(f.name + ' is larger than 15 MB.'); return; }
        if (staged.length >= 10) { rejected++; return; }
        staged.push(f);
      });
      if (rejected) alert(source === 'paste' ? 'The clipboard does not contain an image. Take a screenshot first (Win+Shift+S or PrtScn), then paste.' : 'Only images and PDFs can be attached (maximum 10 per save).');
      render();
      zone.classList.remove('flash'); void zone.offsetWidth; zone.classList.add('flash');
    }
    cform._addEvidence = add;

    const activate = () => { activeCheckForm = cform; $$('[data-paste-zone].active').forEach((z) => z.classList.remove('active')); zone.classList.add('active'); };
    cform.addEventListener('focusin', activate);
    cform.addEventListener('pointerdown', activate);
    zone.addEventListener('click', (e) => { if (!e.target.closest('label')) zone.focus(); });
    zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('[data-paste-browse]', zone).click(); } });
    $('[data-paste-browse]', zone).addEventListener('change', (e) => { const picked = Array.from(e.target.files); e.target.value = ''; add(picked, 'browse'); });
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); }));
    zone.addEventListener('drop', (e) => { activate(); add(e.dataTransfer.files, 'drop'); });

    cform.addEventListener('submit', async (e) => {
      if (!staged.length) return; // plain form post is fine without new files
      e.preventDefault();
      const btn = $('[data-check-save]', cform);
      btn.disabled = true; btn.textContent = 'Saving…';
      const fd = new FormData(cform);
      fd.delete('evidence');
      staged.forEach((f) => fd.append('evidence', f, f.name || 'screenshot.' + extOf(f)));
      try {
        const r = await fetch(cform.action, { method: 'POST', body: fd, headers: { Accept: 'application/json' } });
        const res = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(res.error || 'Upload failed');
        staged.length = 0;
        const dest = new URL(res.redirect, location.href);
        // Same page + query with only a #hash would not reload, so force it to show the saved evidence.
        if (dest.pathname + dest.search === location.pathname + location.search) { location.hash = dest.hash; location.reload(); } else location.assign(dest.href);
      } catch (err) {
        alert(err.message || 'Could not save – please try again.');
        btn.disabled = false; btn.textContent = 'Save check';
      }
    });
  }
  $$('[data-check-form]').forEach(initCheckForm);

  // Ctrl+V anywhere on the page goes to the check you last clicked into (unless pasting text into a field).
  document.addEventListener('paste', (e) => {
    if (!$('[data-check-form]')) return;
    const cd = e.clipboardData;
    if (!cd) return;
    const files = Array.from(cd.files || []).filter((f) => EV_TYPES.test(f.type));
    if (!files.length) Array.from(cd.items || []).forEach((it) => { if (it.kind === 'file') { const f = it.getAsFile(); if (f && EV_TYPES.test(f.type)) files.push(f); } });
    const inText = e.target.matches && e.target.matches('input[type=text], input:not([type]), textarea');
    if (!files.length) {
      if (!inText && e.target.closest && e.target.closest('[data-paste-zone]')) { e.preventDefault(); alert('The clipboard does not contain an image. Take a screenshot first (Win+Shift+S or PrtScn), then paste.'); }
      return;
    }
    const target = (e.target.closest && e.target.closest('[data-check-form]')) || activeCheckForm || ($$('details[data-check][open] [data-check-form]').length === 1 ? $('details[data-check][open] [data-check-form]') : null);
    if (!target) { alert('Open the check you want to attach this screenshot to, click into it, then paste again.'); return; }
    e.preventDefault();
    // Clipboard screenshots usually arrive as "image.png" – give them a sensible working name.
    const named = files.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], 'screenshot-' + Date.now() + '-' + i + '.' + (f.type.split('/')[1] || 'png'), { type: f.type })));
    target.closest('details').open = true;
    target._addEvidence(named, 'paste');
    $('[data-paste-zone]', target).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  // ---------- Section form ----------
  const form = $('[data-section-form]');
  if (!form) return;

  const directFields = (scope) => $$('[data-field]', scope).filter((el) => el.parentElement.closest('[data-scope]') === scope);

  function readField(el) {
    const t = el.dataset.type;
    switch (t) {
      case 'yesno': case 'radio': { const c = $('input[type=radio]:checked', el); return c ? c.value : ''; }
      case 'checkboxes': return $$('input[type=checkbox]:checked', el).map((c) => c.value);
      case 'confirm': return $('input[type=checkbox]', el).checked ? 'yes' : '';
      case 'signature': { const s = $('[data-sig]', el)._sig; return s && s.image ? { image: s.image } : null; }
      case 'files': return undefined;
      case 'month': return monthValue($('[data-month-pick]', el));
      case 'repeater': return $$(':scope > .rep > [data-rows] > [data-row]', el).map((row) => Object.assign({ _id: row.dataset.id }, collect($('[data-scope]', row))));
      default: { const i = $('input, textarea, select', el); return i ? i.value : ''; }
    }
  }

  function collect(scope) {
    const out = {};
    directFields(scope).forEach((el) => { const v = readField(el); if (v !== undefined) out[el.dataset.key] = v; });
    return out;
  }

  function evalShow(rule, vals) {
    const v = vals[rule.key];
    if (rule.eq !== undefined) return v === rule.eq;
    if (rule.ne !== undefined) return v !== rule.ne;
    if (rule.in) return rule.in.indexOf(v) !== -1;
    return true;
  }

  function applyVisibility() {
    const scopes = [$('[data-scope]', form)].concat($$('[data-row] > [data-scope]', form));
    scopes.forEach((scope) => {
      const vals = collect(scope);
      directFields(scope).forEach((el) => {
        const r = el.dataset.showIf;
        if (r) el.classList.toggle('hidden', !evalShow(JSON.parse(r), vals));
      });
    });
  }

  // Repeaters
  function renumber(rep) {
    let labels = [];
    try { labels = rep.dataset.labels ? JSON.parse(rep.dataset.labels) : []; } catch (e) { labels = []; }
    const rows = $$(':scope > [data-rows] > [data-row]', rep);
    rows.forEach((row, i) => { const t = $('[data-row-title]', row); if (t) t.textContent = labels[i] || (rep.dataset.label + ' ' + (i + 1)); });
    const min = Number(rep.dataset.min || 0); const max = Number(rep.dataset.max || 30);
    rows.forEach((row) => { const rb = $(':scope > .rep-row-head [data-remove]', row); if (rb) rb.style.visibility = rows.length <= min ? 'hidden' : ''; });
    const add = $(':scope > [data-add]', rep); if (add) add.style.display = rows.length >= max ? 'none' : '';
  }
  $$('[data-rep]', form).forEach((rep) => {
    renumber(rep);
    const add = $(':scope > [data-add]', rep);
    if (add) add.addEventListener('click', () => {
      const html = $(':scope > template', rep).innerHTML.split('__ROW__').join(hexId());
      const wrapDiv = document.createElement('div'); wrapDiv.innerHTML = html.trim();
      const row = wrapDiv.firstElementChild;
      $(':scope > [data-rows]', rep).appendChild(row);
      $$('[data-sig]', row).forEach(initSig); $$('[data-files]', row).forEach(initFiles);
      renumber(rep); applyVisibility(); changed(); updateTimeline();
      const first = $('input, select, textarea', row); if (first) first.focus();
    });
    rep.addEventListener('click', (e) => {
      const rb = e.target.closest('[data-remove]');
      if (!rb || rb.closest('[data-rep]') !== rep) return;
      if (!confirm('Remove this entry?')) return;
      rb.closest('[data-row]').remove(); renumber(rep); changed(); updateTimeline();
    });
  });

  // 5-year timeline
  const tl = $('[data-timeline]', form);
  const years = Number(form.dataset.periodYears || 5);
  function updateTimeline() {
    if (!tl) return;
    const histEl = $$('[data-field][data-key="history"]', form)[0];
    const hist = histEl ? readField(histEl) : [];
    const now = new Date(); const nowIdx = now.getFullYear() * 12 + now.getMonth(); const start = nowIdx - years * 12;
    const toIdx = (ym) => { const p = ym.split('-'); return Number(p[0]) * 12 + Number(p[1]) - 1; };
    const covered = new Set();
    hist.forEach((h) => {
      if (!/^\d{4}-\d{2}$/.test(h.from || '')) return;
      const a = toIdx(h.from); const b = h.current === 'yes' ? nowIdx : (/^\d{4}-\d{2}$/.test(h.to || '') ? toIdx(h.to) : null);
      if (b === null || b < a) return;
      for (let i = a; i <= Math.min(b, nowIdx); i++) covered.add(i);
    });
    const bar = $('[data-tl-bar]', tl); bar.innerHTML = '';
    const gaps = []; let run = null; let ok = 0;
    for (let i = start; i < nowIdx; i++) {
      const c = covered.has(i);
      if (c) ok++;
      const seg = document.createElement('i'); seg.className = c ? 'ok' : 'gap'; seg.style.width = (100 / (nowIdx - start)) + '%';
      seg.title = fmtMonth(Math.floor(i / 12) + '-' + String((i % 12) + 1).padStart(2, '0'));
      bar.appendChild(seg);
      if (!c) { if (!run) run = [i, i]; else run[1] = i; } else if (run) { gaps.push(run); run = null; }
    }
    if (run) gaps.push(run);
    const ym = (i) => Math.floor(i / 12) + '-' + String((i % 12) + 1).padStart(2, '0');
    $('[data-tl-start]', tl).textContent = fmtMonth(ym(start));
    const pct = Math.round((ok / (nowIdx - start)) * 100);
    const badge = $('[data-tl-pct]', tl);
    badge.textContent = pct + '% covered';
    badge.className = 'badge plain ' + (pct === 100 ? 'tone-good' : pct > 60 ? 'tone-warn' : 'tone-bad');
    $('[data-tl-gaps]', tl).innerHTML = gaps.length
      ? gaps.map((g) => '<li>⚠ Gap: ' + fmtMonth(ym(g[0])) + (g[1] > g[0] ? ' – ' + fmtMonth(ym(g[1])) : '') + ' (' + (g[1] - g[0] + 1) + ' month' + (g[1] > g[0] ? 's' : '') + ')</li>').join('')
      : '<li style="color:var(--good)">✓ Your ' + years + '-year history is continuous.</li>';
  }

  const status = $('[data-save-status]');

  // ---------- Autosave ----------
  // Phones often discard background tabs (e.g. when the user switches to the camera or their banking app)
  // and iOS never fires "unsaved changes" warnings, so save quietly as people type and when they leave.
  const editable = !!$('[data-save]');
  const url = '/apply/section/' + form.dataset.section;
  const hhmm = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  let dirty = false; let timer = null;
  function autosave(leaving) {
    clearTimeout(timer);
    if (!editable || !dirty) return;
    const body = JSON.stringify({ action: 'autosave', data: collect($('[data-scope]', form)) });
    dirty = false;
    status.textContent = 'Saving…';
    // keepalive lets the request finish while the page is closing, but browsers cap it at 64 KB.
    fetch(url, { method: 'POST', keepalive: leaving && body.length < 60000, headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': CSRF }, body })
      .then((r) => { if (!r.ok) throw new Error(); status.textContent = 'Saved automatically at ' + hhmm(); })
      .catch(() => { dirty = true; status.textContent = 'Not saved yet – check your connection'; });
  }
  const changed = () => { dirty = true; clearTimeout(timer); timer = setTimeout(autosave, 2500); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') autosave(true); });
  window.addEventListener('pagehide', () => autosave(true));

  form.addEventListener('input', (e) => { changed(); applyVisibility(); updateTimeline(); clearErr(e.target.closest('[data-field]')); });
  form.addEventListener('change', (e) => {
    changed(); applyVisibility(); updateTimeline(); clearErr(e.target.closest('[data-field]'));
    if (e.target.matches('input[data-upper]')) e.target.value = e.target.value.toUpperCase();
  });
  form.addEventListener('focusout', (e) => { if (e.target.matches('input[data-upper]')) e.target.value = e.target.value.toUpperCase(); });
  window.addEventListener('beforeunload', (e) => { if (dirty) { autosave(true); e.preventDefault(); e.returnValue = ''; } });
  applyVisibility(); updateTimeline();

  function clearErr(el) { if (!el) return; el.classList.remove('has-error'); const e = $(':scope > [data-err]', el); if (e) e.textContent = ''; }

  function showErrors(errors) {
    $$('[data-field].has-error', form).forEach(clearErr);
    const box = $('[data-form-error]', form);
    let first = null; let unmatched = [];
    Object.keys(errors).forEach((path) => {
      const el = $$('[data-field]', form).find((f) => f.dataset.path === path);
      if (el) {
        el.classList.add('has-error');
        $(':scope > [data-err]', el).textContent = errors[path];
        // open any hidden parents
        if (!first) first = el;
      } else unmatched.push(errors[path]);
    });
    const n = Object.keys(errors).length;
    box.innerHTML = '<strong>Please correct ' + n + ' item' + (n > 1 ? 's' : '') + ' before continuing.</strong>' + unmatched.map((m) => '<div>' + m.replace(/</g, '&lt;') + '</div>').join('');
    box.classList.remove('hidden');
    (first || box).scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  $$('[data-save]').forEach((btn) => btn.addEventListener('click', async () => {
    clearTimeout(timer);
    $$('[data-sig]', form).forEach((h) => { if (h._acceptPending) h._acceptPending(); });
    const action = btn.dataset.save;
    const data = collect($('[data-scope]', form));
    $$('[data-save]').forEach((b) => { b.disabled = true; });
    status.textContent = 'Saving…';
    try {
      const r = await fetch('/apply/section/' + form.dataset.section, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': CSRF },
        body: JSON.stringify({ action, data }),
      });
      const res = await r.json();
      if (!r.ok) throw new Error(res.error || 'Save failed');
      dirty = false;
      if (res.ok && res.next) { location.href = res.next; return; }
      if (!res.ok) { showErrors(res.errors); status.textContent = 'Draft saved – some items need attention'; }
      else { $('[data-form-error]', form).classList.add('hidden'); status.textContent = 'Draft saved at ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
    } catch (e) {
      status.textContent = 'Not saved';
      alert(e.message || 'Could not save – please check your connection and try again.');
    } finally {
      $$('[data-save]').forEach((b) => { b.disabled = false; });
    }
  }));
})();

/* Admin signature pads outside section forms are initialised above via [data-sig]. */
