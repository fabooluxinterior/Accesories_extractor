(function () {
  const $ = id => document.getElementById(id);
  const drop = $('drop'), fileInput = $('file'), statusEl = $('status'), resultEl = $('result'), dbInfo = $('dbinfo');
  const printBtn = $('printBtn'), againBtn = $('againBtn'), imgPick = $('imgPick'), shell = $('shell');

  let lastMatrix = null;   // the uploaded estimate stays in memory only
  let lastName = '';
  let lastResult = null;
  let pending = null;      // which manual image box is waiting for a file
  const manual = Object.create(null);   // room name -> manually added rows (survive sheet re-syncs)
  const editing = new Set();            // room names currently in "add item" mode
  const origTitle = document.title;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function setStatus(msg, err) { statusEl.textContent = msg || ''; statusEl.className = err ? 'err' : ''; }

  // ---------- sheet sync status ----------
  function paintSync() {
    const s = FB_sheet.status();
    if (!s.configured) { dbInfo.textContent = 'Setup needed: add API key in settings.js'; dbInfo.style.color = '#f87171'; return; }
    if (!s.ok) { dbInfo.textContent = s.error || 'Loading sheet…'; dbInfo.style.color = s.error ? '#f87171' : ''; return; }
    const ago = s.lastCheck ? Math.max(0, Math.round((Date.now() - s.lastCheck) / 1000)) + 's ago' : 'saved copy';
    dbInfo.textContent = `Sheet synced ${ago} · ${s.items} accessories` + (s.error ? ' · ' + s.error : '');
    dbInfo.style.color = s.error ? '#f87171' : '';
  }

  // ---------- extraction (instant, all local) ----------
  function extract(reason) {
    if (!lastMatrix) return;
    const s = FB_sheet.status();
    if (!s.ok) { setStatus(s.error || 'Loading sheet data…', !!s.error); return; }
    const t0 = performance.now();
    try {
      lastResult = FB_extractor.processEstimate(lastMatrix, FB_sheet.getDatabase().catalog, lastName);
      render();
      const ms = Math.round(performance.now() - t0);
      const um = lastResult.unmatched.length;
      setStatus((reason === 'sheet' ? `Sheet changed: results updated automatically (${ms} ms)` : `Done in ${ms} ms`)
        + (um ? ` · ⚠ ${um} item${um === 1 ? '' : 's'} not found in the database` : ''), !!um);
    } catch (e) {
      lastResult = null;
      render();
      setStatus(e.message, true);
    }
  }

  async function handleFile(file) {
    setStatus('Reading…');
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellFormula: false, cellHTML: false, cellStyles: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      lastMatrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
      lastName = file.name.replace(/\.[^.]+$/, '');
      for (const k in manual) delete manual[k];   // a new estimate starts clean
      editing.clear();
      extract('upload');
      FB_sheet.refresh();
    } catch (e) {
      setStatus('Could not read that file: ' + e.message, true);
    }
  }

  // ---------- rendering ----------
  function picture(img) {
    if (!img) return '';
    return `<img class="sw" loading="lazy" referrerpolicy="no-referrer" src="${esc(img)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'sw'}))">`;
  }

  const extractedRow = r => `<tr><td class="prod">${r.matched ? esc(r.item) : `<div class="fin-name miss">${esc(r.item)}</div><div class="miss-note">⚠ Not found in database</div>`}</td>
    <td><div class="spec">${esc(r.spec)}</div></td><td class="qty">${esc(r.qty)}</td><td>${picture(r.image)}</td></tr>`;

  const manualStatic = r => `<tr><td class="prod">${esc(r.item)}</td><td><div class="spec">${esc(r.spec)}</div></td><td class="qty">${esc(r.qty)}</td><td>${picture(r.img)}</td></tr>`;

  function imgBox(img) {
    return `<div class="imgbox" data-act="pick" data-f="img">${img ? `<img src="${img}" alt=""><span class="rm" data-act="imgrm" data-f="img">✕</span>` : '+ Image'}</div>`;
  }
  const manualEdit = (r, i) => `<tr data-i="${i}">
    <td><input class="inp b" data-f="item" value="${esc(r.item)}" placeholder="New Item"><button class="btn-del" data-act="del">Delete Row</button></td>
    <td><textarea class="inp" data-f="spec" rows="2" placeholder="Specification">${esc(r.spec)}</textarea></td>
    <td><input class="inp" data-f="qty" value="${esc(r.qty)}" placeholder="1"></td>
    <td>${imgBox(r.img)}</td></tr>`;

  function render() {
    const has = !!(lastResult && lastResult.rooms.length);
    shell.classList.toggle('has-results', !!lastMatrix && !!lastResult);
    printBtn.hidden = !has;
    againBtn.hidden = !lastMatrix;
    if (!lastResult) { resultEl.innerHTML = ''; return; }
    if (!has) { resultEl.innerHTML = '<p style="color:var(--muted);margin-top:24px">No accessories found in this estimate.</p>'; return; }

    const um = lastResult.unmatched || [];
    const banner = um.length ? `<div class="warn no-print"><b>⚠ ${um.length} item${um.length === 1 ? '' : 's'} in this estimate ${um.length === 1 ? 'is' : 'are'} not in the database</b>
      <span>They are highlighted in red below. Add ${um.length === 1 ? 'it' : 'them'} to the masterdata sheet and this page updates by itself within a minute.</span>
      <ul>${um.map(u => `<li><b>${esc(u.name)}</b> <small>${esc(u.rooms.join(', '))}</small></li>`).join('')}</ul></div>` : '';
    resultEl.innerHTML = banner + lastResult.rooms.map((room, ri) => {
      const isEd = editing.has(room.name);
      const rows = (manual[room.name] || []).map((r, i) => isEd ? manualEdit(r, i) : manualStatic(r)).join('');
      return `<section class="room" data-room="${ri}">
        <div class="room-head">${esc(room.name)}</div>
        <table>
          <colgroup><col class="c-item"><col class="c-spec"><col class="c-qty"><col class="c-img"></colgroup>
          <thead><tr><th>Item Name</th><th>Specification</th><th>Qty</th><th>Image</th></tr></thead>
          <tbody>${room.rows.map(extractedRow).join('')}${rows}</tbody>
        </table>
        <div class="actions no-print"><button class="btn-pill" data-act="add">+ Add Manual Item</button>${isEd ? '<button class="btn-done" data-act="done">Done</button>' : ''}</div>
      </section>`;
    }).join('');
  }

  // ---------- manual items ----------
  const blank = () => ({ item: '', spec: '', qty: '', img: '' });
  const isEmptyRow = r => !(r.item || r.spec || r.qty || r.img);

  function finishEditing(name) {
    manual[name] = (manual[name] || []).filter(r => !isEmptyRow(r));
    editing.delete(name);
  }
  function finishAll() { [...editing].forEach(finishEditing); }

  function roomOf(el) {
    const sec = el.closest('.room');
    return sec && lastResult ? lastResult.rooms[+sec.dataset.room] : null;
  }

  function readImage(file) {
    return new Promise(resolve => {
      const fr = new FileReader();
      fr.onload = () => {
        const im = new Image();
        im.onload = () => {
          const max = 260, k = Math.min(1, max / Math.max(im.width, im.height));
          const c = document.createElement('canvas');
          c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.88));
        };
        im.onerror = () => resolve('');
        im.src = fr.result;
      };
      fr.onerror = () => resolve('');
      fr.readAsDataURL(file);
    });
  }

  resultEl.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    const room = el && roomOf(el);
    if (!room) return;
    const list = manual[room.name] || (manual[room.name] = []);
    const tr = el.closest('tr');
    const i = tr ? +tr.dataset.i : -1;

    switch (el.dataset.act) {
      case 'add': {
        const sec = el.closest('.room');
        list.push(blank());
        editing.add(room.name);
        render();
        const rows = resultEl.querySelectorAll(`.room[data-room="${sec.dataset.room}"] tr[data-i] [data-f="item"]`);
        if (rows.length) rows[rows.length - 1].focus();
        break;
      }
      case 'done': finishEditing(room.name); render(); break;
      case 'del': list.splice(i, 1); render(); break;
      case 'pick': pending = { room: room.name, i, f: el.dataset.f }; imgPick.click(); break;
      case 'imgrm': e.stopPropagation(); list[i][el.dataset.f] = ''; render(); break;
    }
  });

  resultEl.addEventListener('input', e => {
    const f = e.target.dataset && e.target.dataset.f;
    if (!f || e.target.type === 'file') return;
    const room = roomOf(e.target);
    const tr = e.target.closest('tr');
    if (room && tr && manual[room.name] && manual[room.name][+tr.dataset.i]) manual[room.name][+tr.dataset.i][f] = e.target.value;
  });

  imgPick.addEventListener('change', async () => {
    const file = imgPick.files[0];
    imgPick.value = '';
    if (!file || !pending) return;
    const data = await readImage(file);
    const row = manual[pending.room] && manual[pending.room][pending.i];
    if (row && data) { row[pending.f] = data; render(); }
    pending = null;
  });

  // ---------- PDF: built in the page, always A4 landscape, downloaded directly ----------
  function pdfRooms() {
    return lastResult.rooms.map(room => {
      const rows = room.rows.map(r => ({ item: r.item, spec: r.spec, qty: r.qty, img: r.image, missing: !r.matched }));
      (manual[room.name] || []).forEach(m => {
        if (isEmptyRow(m)) return;
        rows.push({ item: m.item, spec: m.spec, qty: m.qty, img: m.img, missing: false });
      });
      return { name: room.name, rows };
    });
  }

  printBtn.addEventListener('click', async () => {
    if (!lastResult) return;
    finishAll();
    render();
    const title = (lastResult.name || 'Accessories').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Accessories';
    printBtn.disabled = true;
    setStatus('Preparing PDF…');
    try {
      const out = await FB_pdf.create(pdfRooms(), { title });
      FB_pdf.download(out.blob, title + '.pdf');
      setStatus(out.missing
        ? `PDF downloaded (A4 landscape), but ${out.missing} image(s) could not be added because the image host blocked them. They show as empty dotted boxes.`
        : `PDF downloaded: ${title}.pdf (A4 landscape, ${out.pages} page${out.pages === 1 ? '' : 's'})`, !!out.missing);
    } catch (e) {
      console.error(e);
      setStatus('Could not build the PDF directly (' + e.message + '). Opening the browser print dialog instead: choose A4, Landscape, and turn off Headers and footers.', true);
      document.title = title;
      setTimeout(() => window.print(), 50);
    } finally {
      printBtn.disabled = false;
    }
  });
  window.addEventListener('afterprint', () => { document.title = origTitle; });

  // ---------- wiring ----------
  drop.addEventListener('click', () => fileInput.click());
  againBtn.addEventListener('click', () => fileInput.click());
  ['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  document.addEventListener('drop', e => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f && /\.(xlsx|xls|xlsm)$/i.test(f.name)) handleFile(f); });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); fileInput.value = ''; });
  $('syncBtn').addEventListener('click', () => { dbInfo.textContent = 'Syncing…'; FB_sheet.refresh({ force: true }); });

  FB_sheet.onChange((s, changed) => {
    paintSync();
    if (changed && lastMatrix) extract('sheet');
  });
  setInterval(paintSync, 1000);
  paintSync();
  render();
  FB_sheet.start();
})();
