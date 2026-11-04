// Port of extractFabooluxData() from the Apps Script (accessories). Same rules, runs in the browser.
(function () {
  // masterdata rows (first row = header): column A item, B specification, C image link.
  // Returned longest-name-first, exactly like the original matching order.
  function prepCatalog(rows) {
    const catalog = [];
    for (let i = 1; i < (rows || []).length; i++) {
      const r = rows[i] || [];
      const item = String(r[0] || '').trim();
      const spec = String(r[1] || '').trim();
      const link = String(r[2] || '').trim();
      if (item) catalog.push({ item: item, spec: spec, imageLink: link });
    }
    return catalog.slice().sort((a, b) => b.item.length - a.item.length).map(c => {
      const norm = c.item.toLowerCase().replace(/\s+/g, ' ').trim();
      return { item: c.item, spec: c.spec, imageLink: c.imageLink, norm: norm, nums: norm.match(/\b\d+\b/g) || [] };
    });
  }

  // Google Drive links become direct image links; anything that is not a link is ignored.
  function imageUrl(link) {
    let u = String(link || '').trim();
    const m = u.match(/(https?:\/\/[^\s"'<>]+)/i);
    if (!m) return '';
    u = m[1];
    if (/drive\.google\.com|docs\.google\.com|googleusercontent\.com/.test(u)) {
      const d = u.match(/(?:id=|\/d\/)([a-zA-Z0-9-_]+)/);
      if (d) u = 'https://lh3.googleusercontent.com/d/' + d[1];
    }
    return u;
  }

  // Returns [{ room, item, spec, qty, imageLink, matched }] in the order found.
  function extractAccessories(data, sortedCatalog) {
    if (!data || data.length === 0) return [];

    let isKitchen = false;
    for (let r = 0; r < Math.min(25, data.length); r++) {
      if (!data[r]) continue;
      const rowString = data[r].join(' ').toUpperCase();
      if (rowString.includes('ESTIMATE FOR MODULAR KITCHEN')) { isKitchen = true; break; }
      if (rowString.includes('ESTIMATE FOR MODULAR WARDROBES AND STORAGE')) { isKitchen = false; break; }
    }

    let currentRoom = isKitchen ? 'Kitchen' : 'General Area';
    let inAccessorySection = false;
    const finalData = [];

    let qtyIdx = 16, specIdx = 6, itemIdx = 1;
    let pendingAccessory = null;
    let headerFound = false;

    for (let i = 0; i < data.length; i++) {
      const row = data[i]; if (!row) continue;
      const firstCol = String(row[0] || '').trim();
      const rowContent = row.join(' ').toLowerCase();

      const isHeaderRow = !headerFound && (rowContent.includes('qty') || rowContent.includes('quantity') || rowContent.includes('nos')) &&
                          (rowContent.includes('item') || rowContent.includes('particulars') || rowContent.includes('description'));

      if (isHeaderRow) {
        for (let col = 0; col < row.length; col++) {
          const val = String(row[col] || '').toLowerCase().trim();
          if (val === 'qty' || val === 'quantity' || val === 'nos' || val === 'nos.') {
            qtyIdx = col;
          } else if (val === 'specifications' || val === 'specification' || val.includes('code') || val.includes('spec') || val.includes('finish')) {
            specIdx = col;
          } else if (val === 'item' || val === 'particulars' || val === 'description') {
            itemIdx = col;
          }
        }
        headerFound = true;
        continue;
      }

      const filledCols = row.filter(c => String(c).trim() !== '').length;
      if (filledCols >= 1 && filledCols <= 2 && isNaN(firstCol) && firstCol.length > 2) {
        const cleanText = firstCol.toLowerCase();
        const isAccessoryHeader = cleanText.includes('accessories') || cleanText.includes('hardware') || cleanText.includes('fittings');
        const isIgnoredHeader = cleanText.includes('total') || cleanText.includes('summary') || cleanText.includes('qty') || cleanText.includes('item') || cleanText.includes('estimate for');

        if (isAccessoryHeader) {
          inAccessorySection = true;
          continue;
        } else if (!isIgnoredHeader) {
          inAccessorySection = false;
          if (!cleanText.includes('cabinet') && !cleanText.includes('woodwork') && !cleanText.includes('shutter')) {
            let detectedRoom = firstCol.replace(/\s*-\s*Room\s*total\s*amount.*/i, '').replace(/\s*Room\s*total\s*amount.*/i, '').trim();

            if (detectedRoom.toUpperCase().includes('CUSTOMER GST')) {
              detectedRoom = 'KITCHEN';
            }

            if (detectedRoom !== '') currentRoom = detectedRoom;
          }
          continue;
        }
      }

      if (rowContent.includes('grand total') || rowContent.includes('signature')) {
        inAccessorySection = false;
        continue;
      }

      if (inAccessorySection) {
        const itemNameRaw = String(row[itemIdx] || '').trim();
        let specValue = specIdx !== -1 ? String(row[specIdx] || '').trim() : '';

        let exactColValue = '';
        let activeQtyCol = -1;

        if (isKitchen) {
          const valQ = String(row[16] || '').trim();
          const valR = String(row[17] || '').trim();
          if (valQ !== '') { exactColValue = valQ; activeQtyCol = 16; }
          else if (valR !== '') { exactColValue = valR; activeQtyCol = 17; }
        } else {
          const valO = String(row[14] || '').trim();
          if (valO !== '') { exactColValue = valO; activeQtyCol = 14; }
        }

        const dynamicColValue = qtyIdx !== -1 ? String(row[qtyIdx] || '').trim() : '';
        let qtyValue = exactColValue !== '' ? exactColValue : dynamicColValue;
        if (activeQtyCol === -1) activeQtyCol = qtyIdx !== -1 ? qtyIdx : (isKitchen ? 16 : 14);

        if (itemNameRaw === '' && (qtyValue !== '' || specValue !== '')) {
          const extraCode = String(row[4] || '').trim();
          pendingAccessory = { spec: (extraCode ? extraCode + '\n' : '') + specValue, qtyRaw: qtyValue };
          continue;
        }

        if (itemNameRaw !== '') {
          if (pendingAccessory) {
            if (specValue === '') specValue = pendingAccessory.spec;
            if (qtyValue === '') qtyValue = pendingAccessory.qtyRaw;
            pendingAccessory = null;
          }

          const searchTarget = itemNameRaw.toLowerCase().replace(/\s+/g, ' ').trim();
          let bestMatchName = '', bestMatchSpec = '', bestMatchImageLink = '';
          const targetNumbers = searchTarget.match(/\b\d+\b/g) || [];

          if (!searchTarget || searchTarget.length < 3 ||
              searchTarget.includes('hardware total') ||
              searchTarget.includes('amount') ||
              searchTarget.includes('supply and installation') ||
              searchTarget.length > 150) {
            continue;
          }

          if (sortedCatalog.length > 0) {
            for (let c = 0; c < sortedCatalog.length; c++) {
              const cat = sortedCatalog[c];
              const catItem = cat.norm;

              if (searchTarget === catItem) {
                bestMatchName = cat.item;
                bestMatchSpec = cat.spec;
                bestMatchImageLink = cat.imageLink;
                break;
              }

              if (searchTarget.includes(catItem)) {
                const catNumbers = cat.nums;
                let isSizeClash = false;

                if (targetNumbers.length > 0 && catNumbers.length > 0) {
                  const sharedNumbers = targetNumbers.filter(n => catNumbers.includes(n));
                  if (sharedNumbers.length !== catNumbers.length) {
                    isSizeClash = true;
                  }
                }

                if (!isSizeClash) {
                  bestMatchName = cat.item;
                  bestMatchSpec = cat.spec;
                  bestMatchImageLink = cat.imageLink;
                  break;
                }
              }
            }
          }

          const finalItemName = bestMatchName !== '' ? bestMatchName : itemNameRaw;
          const finalSpecValue = bestMatchName !== '' ? bestMatchSpec : specValue;
          const isCatalogMatch = bestMatchName !== '';

          let qty = 1, qtyFound = false;

          if (qtyValue !== '') {
            const matchedNumbers = qtyValue.match(/\d+(\.\d+)?/g);
            if (matchedNumbers && matchedNumbers.length > 0) {
              qty = parseFloat(matchedNumbers[matchedNumbers.length - 1]);
              qtyFound = true;
            }
          }

          if (!qtyFound) {
            const neighbors = [activeQtyCol - 1, activeQtyCol + 1, activeQtyCol - 2, activeQtyCol + 2];
            for (let m = 0; m < neighbors.length; m++) {
              const nb = neighbors[m];
              if (nb > itemIdx && nb < row.length) {
                const neighborVal = String(row[nb]).trim().toLowerCase();
                if (neighborVal !== '') {
                  if (/^\d+(\.\d+)?$/.test(neighborVal) || /^\d+(\.\d+)?\s*(nos|set|sets|pcs|pieces)$/.test(neighborVal)) {
                    const matched = neighborVal.match(/\d+(\.\d+)?/);
                    if (matched) {
                      const parsedVal = parseFloat(matched[0]);
                      if (parsedVal < 1000) { qty = parsedVal; qtyFound = true; break; }
                    }
                  }
                }
              }
            }
          }

          if (!qtyFound) {
            const combinedText = (itemNameRaw + ' ' + specValue).toLowerCase();
            const explicitMatch = combinedText.match(/\b(\d+)\s*(nos|set|sets|pcs|pieces|qty)\b/);
            if (explicitMatch) { qty = parseFloat(explicitMatch[1]); qtyFound = true; }
          }

          if (isNaN(qty) || qty === 0) qty = 1;
          finalData.push({ room: currentRoom, item: finalItemName, spec: finalSpecValue, qty: qty, imageLink: bestMatchImageLink, matched: isCatalogMatch });
        } else if (specValue !== '' && finalData.length > 0) {
          const last = finalData[finalData.length - 1];
          if (!last.matched) {
            if (!last.spec.includes(specValue)) {
              last.spec += (last.spec === '' ? '' : '\n') + specValue;
            }
          }
        }
      }
    }
    return finalData;
  }

  // Page-ready result: rooms (one card each) + the items that are not in the database.
  function processEstimate(matrix, sortedCatalog, name) {
    const items = extractAccessories(matrix, sortedCatalog);
    const rooms = [], byKey = new Map();
    items.forEach(it => {
      const k = it.room.toLowerCase();
      let r = byKey.get(k);
      if (!r) { r = { name: it.room, rows: [] }; byKey.set(k, r); rooms.push(r); }
      r.rows.push({ item: it.item, spec: it.spec, qty: it.qty, image: imageUrl(it.imageLink), matched: it.matched });
    });

    const seen = new Map();
    rooms.forEach(room => room.rows.forEach(r => {
      if (r.matched) return;
      const k = r.item.toLowerCase();
      if (!seen.has(k)) seen.set(k, { name: r.item, rooms: [] });
      const e = seen.get(k);
      if (!e.rooms.includes(room.name)) e.rooms.push(room.name);
    }));

    return { name: name, count: items.length, rooms: rooms, unmatched: [...seen.values()] };
  }

  const api = { prepCatalog, extractAccessories, processEstimate, imageUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.FB_extractor = api;
})();
