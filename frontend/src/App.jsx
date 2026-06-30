import { useState, useEffect, useCallback, useRef } from 'react';
import jsPDF from 'jspdf';

const API = 'http://localhost:3001';
const TYPES = ['PERSON', 'PHONE', 'EMAIL', 'DATE', 'MONEY', 'ID_NUMBER', 'OTHER'];

const guessType = (txt) => {
  if (/\(?\d{3}\)?[-\.\s]?\d{3}[-\.\s]?\d{4}/.test(txt)) return 'PHONE';
  if (/[\w.\+-]+@[\w-]+\.[a-zA-Z]{2,}/.test(txt)) return 'EMAIL';
  if (/^[A-Z][a-z]{2,}(\s[A-Z][a-z]{2,}){0,2}$/.test(txt)) return 'PERSON';
  return 'OTHER';
};

const getAdj = (txt, fullTxt, reds) => {
  const idx = fullTxt.indexOf(txt);
  if (idx < 0) return [];
  const res = [];
  const b = fullTxt.slice(0, idx).trimEnd().split(/\s+/).pop();
  if (b) {
    const cl = b.replace(/[.,;:!?"()]+/g, '');
    if (cl.length > 1 && /^[A-Z]/.test(cl) && !reds.some((r) => r.text.includes(cl))) res.push(cl);
  }
  const a = fullTxt.slice(idx + txt.length).trimStart().split(/\s+/)[0];
  if (a) {
    const cl = a.replace(/[.,;:!?"()]+/g, '');
    if (cl.length > 1 && /^[A-Z]/.test(cl) && !reds.some((r) => r.text.includes(cl))) res.push(cl);
  }
  return res;
};

const getUnredacted = (fullTxt, reds) => {
  const issues = [];
  const ph = /[\(]?\d{3}[\)]?[-\.\s]?\d{3}[-\.\s]?\d{4}/g;
  for (const m of fullTxt.matchAll(ph)) {
    if (!reds.some((r) => r.text === m[0])) issues.push({ text: m[0], type: 'PHONE' });
  }
  const em = /[\w.\+-]+@[\w-]+\.[a-zA-Z]{2,}/g;
  for (const m of fullTxt.matchAll(em)) {
    if (!reds.some((r) => r.text === m[0])) issues.push({ text: m[0], type: 'EMAIL' });
  }
  return issues;
};

const getCollisions = (fullTxt, reds) => {
  const issues = [];
  const redactedItems = reds.filter(r => r.status === 'redacted');
  const uniqueRedactedTexts = [...new Set(redactedItems.map(r => r.text))];

  uniqueRedactedTexts.forEach(txt => {
    if (!txt || txt.length < 2) return;

    const safeTxt = txt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const isWord = /^\w+$/.test(txt);
    const regex = isWord ? new RegExp(`\\b${safeTxt}\\b`, 'g') : new RegExp(safeTxt, 'g');
    const matchesInDoc = [...fullTxt.matchAll(regex)];

    const trackingCount = reds.filter(r => r.text === txt).length;

    if (matchesInDoc.length > trackingCount) {
      const diff = matchesInDoc.length - trackingCount;
      const type = redactedItems.find(r => r.text === txt)?.type || 'OTHER';

      for (let i = 0; i < diff; i++) {
        issues.push({ text: txt, type });
      }
    }
  });

  return issues;
};

export default function App() {
  const [docList, setDocList] = useState([]);
  const [doc, setDoc] = useState('');
  const [docTitle, setDocTitle] = useState('');
  const [id, setId] = useState('');

  const [docVersions, setDocVersions] = useState([]);
  const [activeVersionId, setActiveVersionId] = useState('current');
  const [reds, setReds] = useState([]);
  const [origReds, setOrigReds] = useState(null);

  const [curDocId, setCurDocId] = useState('api');
  const [openAccordionId, setOpenAccordionId] = useState('api');

  const [tab, setTab] = useState('Risks');
  const [leftCol, setLeftCol] = useState(false);

  const [conf, setConf] = useState(null);
  const [sel, setSel] = useState(null);
  const [selT, setSelT] = useState(TYPES[0]);
  const [prox, setProx] = useState([]);

  const [expState, setExpState] = useState(null);
  const [exportFormat, setExportFormat] = useState('txt');

  const [exportCollisions, setExportCollisions] = useState([]);
  const [exportHighRisks, setExportHighRisks] = useState([]);
  const [confirmText, setConfirmText] = useState('');

  const [toast, setToast] = useState(null);

  const vRef = useRef(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadDocs = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/documents`);
      const d = await r.json();
      setDocList(d);
    } catch (e) {
      console.log('Failed to fetch doc list');
    }
  }, []);

  const loadDoc = useCallback(async (docId, targetVersionId = 'current') => {
    try {
      const r = await fetch(`${API}/api/document/${docId}`);
      const d = await r.json();
      setId(d.documentId);
      setDocTitle(d.title || d.documentId);
      setDoc(d.documentText.replace(/—/g, '-'));
      setDocVersions(d.versions || []);

      const vArr = d.versions || [];
      let ver = vArr.find(v => v.id === targetVersionId);
      if (!ver && vArr.length > 0) ver = vArr[vArr.length - 1];
      if (!ver) ver = { id: 'current', redactions: d.redactions || [] };

      setActiveVersionId(ver.id);
      setReds(ver.redactions);

      const ogVer = vArr.find(v => v.id === 'original');
      setOrigReds(ogVer ? JSON.parse(JSON.stringify(ogVer.redactions)) : null);

      setCurDocId(docId);
      setOpenAccordionId(docId);
      setConf(null);
    } catch (e) {
      console.log('Failed to load doc');
    }
  }, []);

  useEffect(() => {
    loadDocs();
    loadDoc('api', 'current');
  }, [loadDocs, loadDoc]);

  const createVersion = async () => {
    try {
      const r = await fetch(`${API}/api/document/${curDocId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceVersionId: activeVersionId })
      });
      const newV = await r.json();
      await loadDoc(curDocId, newV.id);
      showToast("New version created!");
    } catch (e) {
      showToast("Failed to create version.");
    }
  };

  const restoreVersion = async () => {
    if (activeVersionId === 'original') return;
    try {
      const r = await fetch(`${API}/api/document/${curDocId}/versions/${activeVersionId}/restore`, {
        method: 'POST'
      });
      await r.json();
      await loadDoc(curDocId, activeVersionId);
      showToast("Restored to original baseline.");
    } catch (e) {
      showToast("Failed to restore.");
    }
  };

  const deleteVersion = async (versionId) => {
    if (versionId === 'original') return;
    try {
      await fetch(`${API}/api/document/${curDocId}/versions/${versionId}`, {
        method: 'DELETE'
      });
      if (activeVersionId === versionId) {
        await loadDoc(curDocId, 'original');
      } else {
        await loadDoc(curDocId, activeVersionId);
      }
      showToast("Version deleted.");
    } catch (e) {
      showToast("Failed to delete version.");
    }
  };

  const tog = async (rId, cur) => {
    if (activeVersionId === 'original') return showToast("Original version is read-only.");
    const n = cur === 'redacted' ? 'visible' : 'redacted';
    try {
      const r = await fetch(`${API}/api/document/${curDocId}/redactions/${rId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: n, versionId: activeVersionId }),
      });
      const u = await r.json();
      setReds((p) => p.map((x) => (x.id === rId ? { ...x, ...u } : x)));
    } catch (e) {
      setReds((p) => p.map((x) => (x.id === rId ? { ...x, status: n } : x)));
    }
    setConf(null);
  };

  const add = async (txt, typ) => {
    if (activeVersionId === 'original') return showToast("Original version is read-only.");
    try {
      const r = await fetch(`${API}/api/document/${curDocId}/redactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: txt, type: typ, versionId: activeVersionId }),
      });
      const u = await r.json();
      setReds((p) => [...p, u]);
    } catch (e) {
      const u = { id: 'new-' + Date.now() + Math.random(), text: txt, type: typ, confidence: 1, status: 'redacted' };
      setReds((p) => [...p, u]);
    }
  };

  const handleAdd = (txt, typ) => {
    add(txt, typ);
    setSel(null);
    setProx([]);
  };

  const handleAddMulti = (txtList, typ) => {
    txtList.forEach(t => add(t, typ));
    setSel(null);
    setProx([]);
  };

  const handleUp = () => {
    const s = window.getSelection();
    const t = s ? s.toString().trim() : '';
    if (!t) return;
    if (vRef.current && s.anchorNode && vRef.current.contains(s.anchorNode)) {
      if (activeVersionId === 'original') return showToast("Original version is read-only.");
      if (reds.some((r) => r.text === t)) return;
      const rg = s.getRangeAt(0);
      const rt = rg.getBoundingClientRect();
      const gt = guessType(t);
      setSel({ text: t, x: rt.left, y: rt.bottom + 4 });
      setSelT(gt);
      setProx(getAdj(t, doc, reds));
    }
  };

  const clearSel = (e) => {
    if (e.target.closest('.selection-popup')) return;
    setTimeout(() => {
      const s = window.getSelection();
      if (!s || !s.toString().trim()) {
        setSel(null);
        setProx([]);
      }
    }, 100);
  };

  const askRem = (r, rect) => {
    if (activeVersionId === 'original') return showToast("Original version is read-only.");
    setConf({ id: r.id, x: rect.left, y: rect.top - 80, item: r });
  };

  const handleRem = (r, el = null) => {
    if (activeVersionId === 'original') return showToast("Original version is read-only.");
    if (r.confidence >= 0.75) {
      let rect = { left: window.innerWidth / 2 - 100, top: window.innerHeight / 2 };
      if (el) { rect = el.getBoundingClientRect(); }
      else {
        const domEl = document.getElementById('span-' + r.id);
        if (domEl) rect = domEl.getBoundingClientRect();
      }
      askRem(r, rect);
    } else {
      tog(r.id, 'redacted');
    }
  };

  const handleSpanClick = (e, r) => {
    if (activeVersionId === 'original') return showToast("Original version is read-only.");
    if (r.status === 'redacted') {
      const og = origReds?.find(o => o.id === r.id);
      if (r.confidence >= 0.75 && og) {
        askRem(r, e.target.getBoundingClientRect());
      } else {
        tog(r.id, 'redacted');
      }
    } else {
      if (r.isNew) add(r.text, r.type);
      else tog(r.id, 'visible');
    }
  };

  const unredactedIssues = getUnredacted(doc, reds);
  const collisionIssues = getCollisions(doc, reds);

  const risksList = [];
  reds.forEach(r => { if (r.status === 'visible') risksList.push(r); });

  const unredactedFakeReds = [
    ...unredactedIssues.map((u, i) => ({
      id: `unr-${i}`, text: u.text, type: u.type, confidence: 1, status: 'visible', isNew: true, isRegexMiss: true
    })),
    ...collisionIssues.map((u, i) => ({
      id: `col-${i}`, text: u.text, type: u.type, confidence: 1, status: 'visible', isNew: true, isCollision: true
    }))
  ];

  risksList.push(...unredactedFakeReds);

  const removalsList = reds.filter(r => {
    const og = origReds?.find(o => o.id === r.id);
    return og && og.status === 'redacted' && r.status === 'visible';
  });

  const redactionsList = reds.filter(r => r.status === 'redacted');

  let curList = [];
  if (tab === 'Risks') curList = risksList;
  else if (tab === 'Redactions') curList = redactionsList;
  else if (tab === 'Removals') curList = removalsList;

  curList.sort((a, b) => b.confidence - a.confidence);

  const buildDoc = () => {
    if (!doc) return null;

    const allItems = [...reds, ...unredactedFakeReds];
    const usedIndices = new Set();

    const pos = allItems.map((r) => {
      let i = doc.indexOf(r.text);
      while (i >= 0 && usedIndices.has(i)) {
        i = doc.indexOf(r.text, i + 1);
      }
      if (i >= 0) {
        usedIndices.add(i);
        return { ...r, s: i, e: i + r.text.length };
      }
      return null;
    }).filter(Boolean).sort((a, b) => a.s - b.s || (b.e - b.s) - (a.e - a.s));

    const non = [];
    let le = 0;
    for (const r of pos) {
      if (r.s >= le) { non.push(r); le = r.e; }
    }

    const seg = [];
    let cur = 0;

    for (const r of non) {
      if (cur < r.s) seg.push(<span key={`p-${cur}`}>{doc.slice(cur, r.s)}</span>);

      let cls = 'span-base ';
      const og = origReds?.find(o => o.id === r.id);
      const isAd = !og;
      const isRm = (og && og.status === 'redacted' && r.status === 'visible') || r.isNew;

      if (r.status === 'redacted') {
        if (isAd) cls += 'redact-user';
        else if (r.confidence >= 0.75) cls += 'redact-high';
        else if (r.confidence >= 0.5) cls += 'redact-med';
        else cls += 'redact-low';
      } else {
        const og = origReds?.find(o => o.id === r.id);
        const isRemoval = og && og.status === 'redacted';
        cls += isRemoval ? 'span-removed' : (r.isRegexMiss || r.isCollision ? 'span-regex-miss' : 'span-risk');
      }

      seg.push(
        <span
          key={r.id}
          id={`span-${r.id}`}
          className={cls}
          onClick={(e) => handleSpanClick(e, r)}
        >
          {r.text}
        </span>
      );
      cur = r.e;
    }
    if (cur < doc.length) seg.push(<span key={`p-${cur}`}>{doc.slice(cur)}</span>);
    return seg;
  };

  const doExp = async (format) => {
    setExportFormat(format);

    try {
      const res = await fetch(`${API}/api/document/${curDocId}/versions/${activeVersionId}/validate`);
      const data = await res.json();

      if (data.collisions && data.collisions.length > 0) {
        setExportCollisions(data.collisions);
        setExpState('collision');
        await loadDoc(curDocId, activeVersionId);
        return;
      }

      if (data.highRisks && data.highRisks.length > 0) {
        setExportHighRisks(data.highRisks);
        setConfirmText('');
        setExpState('confirm');
        return;
      }
    } catch (e) {
      console.error("Validation failed", e);
    }

    proceedExp();
  };

  const proceedExp = () => {
    finExp();
  };

  const finExp = () => {
    setExpState(null);

    const usedExpIndices = new Set();
    const pos = reds.map((r) => {
      let i = doc.indexOf(r.text);
      while (i >= 0 && usedExpIndices.has(i)) {
        i = doc.indexOf(r.text, i + 1);
      }
      if (i >= 0) {
        usedExpIndices.add(i);
        return { ...r, s: i, e: i + r.text.length };
      }
      return null;
    }).filter(Boolean).sort((a, b) => a.s - b.s || (b.e - b.s) - (a.e - a.s));

    const non = [];
    let le = 0;
    for (const r of pos) {
      if (r.s >= le) { non.push(r); le = r.e; }
    }

    let finalTxt = '';
    let cur = 0;
    for (const r of non) {
      finalTxt += doc.slice(cur, r.s);
      if (r.status === 'redacted') {
        finalTxt += '█'.repeat(r.text.length);
      } else {
        finalTxt += r.text;
      }
      cur = r.e;
    }
    finalTxt += doc.slice(cur);

    if (exportFormat === 'pdf') {
      const pdf = new jsPDF('p', 'pt', 'letter');
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(11);

      const margin = 50;
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const maxW = pageW - margin * 2;

      let x = margin;
      let y = margin + 12;
      const lineHeight = 16;
      const rectOffsetY = -11;
      const rectHeight = 15;

      const tokens = [];
      let curHtml = 0;
      for (const r of non) {
        const before = doc.slice(curHtml, r.s);
        if (before) tokens.push({ text: before, redacted: false });
        tokens.push({ text: r.text, redacted: r.status === 'redacted' });
        curHtml = r.e;
      }
      const after = doc.slice(curHtml);
      if (after) tokens.push({ text: after, redacted: false });

      const layoutTokens = [];
      for (const t of tokens) {
        const parts = t.text.split(/([ \t]+|\n)/);
        for (const p of parts) {
          if (p) layoutTokens.push({ text: p, redacted: t.redacted });
        }
      }

      for (const lt of layoutTokens) {
        if (lt.text === '\n') {
          x = margin;
          y += lineHeight;
          if (y > pageH - margin) {
            pdf.addPage();
            y = margin + 12;
          }
          continue;
        }

        const w = pdf.getTextWidth(lt.text);

        if (x + w > margin + maxW && lt.text.trim() !== '') {
          x = margin;
          y += lineHeight;
          if (y > pageH - margin) {
            pdf.addPage();
            y = margin + 12;
          }
        }

        if (lt.redacted) {
          pdf.setFillColor(0, 0, 0);
          pdf.rect(x, y + rectOffsetY, w, rectHeight, 'F');
        } else {
          pdf.text(lt.text, x, y);
        }

        x += w;
      }

      pdf.save(`Conseal_${curDocId}_Redacted.pdf`);
    } else {
      const blob = new Blob([finalTxt], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Conseal_${curDocId}_Redacted.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const handleDocClick = (id) => {
    if (openAccordionId === id) {
      setOpenAccordionId(null);
    } else {
      setOpenAccordionId(id);
      if (curDocId !== id) {
        loadDoc(id, 'current');
      }
    }
  };

  return (
    <div className="app-container" onClick={clearSel}>
      <div className="top-header">
        <div className="logo-area">
          <div className="logo">Conseal</div>
        </div>
        <div className="header-title">Redaction Safety Check / Correction Tool</div>
        <div className="header-right"></div>
      </div>

      <div className="workspace">
        <div className={`left-sidebar ${leftCol ? 'collapsed' : ''}`}>
          <div className="left-sidebar-header">
            <button className="collapse-btn" onClick={() => setLeftCol(!leftCol)}>
              {leftCol ? '▶' : '◀'}
            </button>
          </div>
          <div className="doc-list">

            {docList.map(d => {
              const isOpen = openAccordionId === d.id;
              return (
                <div key={d.id} className="doc-item">
                  <div className="doc-title-row" onClick={() => handleDocClick(d.id)}>
                    <span className={`doc-title ${curDocId !== d.id ? 'inactive' : ''}`}>{d.title}</span>
                    <span className={`accordion-icon ${isOpen ? 'open' : ''}`}>▼</span>
                  </div>
                  {isOpen && (
                    <div className="accordion-content">
                      {docVersions.map((v) => (
                        <div
                          key={v.id}
                          className={`version-item ${activeVersionId === v.id ? 'active' : ''}`}
                        >
                          <span className="version-name" onClick={() => loadDoc(d.id, v.id)}>{v.name}</span>
                          {v.id !== 'original' && (
                            <button className="delete-version-btn" onClick={(e) => { e.stopPropagation(); deleteVersion(v.id); }}>✕</button>
                          )}
                        </div>
                      ))}
                      <button className="version-create-btn" onClick={createVersion}>+ New Version</button>
                    </div>
                  )}
                </div>
              );
            })}

          </div>
        </div>

        <div className="document-pane" ref={vRef} onMouseUp={handleUp}>
          <div className="document-content">
            {activeVersionId === 'original' && (
              <div className="readonly-banner">
                <span className="lock-icon">🔒</span> You are viewing the original read-only baseline.
              </div>
            )}
            {buildDoc()}
          </div>
        </div>

        <div className="sidebar">
          <div className="sidebar-header">
            <div className="sidebar-top-row">
              <div className="sidebar-title">Review</div>
              <div className="export-actions">
                {activeVersionId !== 'original' && (
                  <button className="restore-btn outline" onClick={restoreVersion}>Restore</button>
                )}
                <button className="export-btn outline" onClick={() => doExp('txt')}>TXT</button>
                <button className="export-btn" onClick={() => doExp('pdf')}>PDF</button>
              </div>
            </div>
            <div className="sidebar-tabs">
              <div className={`tab ${tab === 'Risks' ? 'active' : ''}`} onClick={() => setTab('Risks')}>
                Risks ({risksList.length})
              </div>
              <div className={`tab ${tab === 'Redactions' ? 'active' : ''}`} onClick={() => setTab('Redactions')}>
                Redactions ({redactionsList.length})
              </div>
              <div className={`tab ${tab === 'Removals' ? 'active' : ''}`} onClick={() => setTab('Removals')}>
                Removals ({removalsList.length})
              </div>
            </div>
          </div>
          <div className="sidebar-content">
            {curList.length === 0 && (
              <div style={{ color: '#6d7383', fontSize: 14, textAlign: 'center', marginTop: 20 }}>No items here.</div>
            )}
            {curList.map(r => (
              <div key={r.id} className="redaction-card">
                <div className="card-header">
                  <span className="card-type">{r.type}</span>
                  <span className={`card-risk ${r.isRegexMiss || r.isCollision ? 'risk-regex' : (r.confidence >= 0.75 ? 'risk-high' : r.confidence >= 0.5 ? 'risk-med' : 'risk-low')}`}>
                    {r.isRegexMiss ? 'REGEX MISS' : r.isCollision ? 'INCONSISTENCY' : (r.confidence >= 0.75 ? 'High Risk' : r.confidence >= 0.5 ? 'Med Risk' : 'Low Risk')}
                  </span>
                </div>
                <div className="card-text">{r.text}</div>
                <div className="card-actions">
                  {r.status === 'visible' ? (
                    <button className="card-btn primary" onClick={() => r.isNew ? add(r.text, r.type) : tog(r.id, 'visible')} disabled={activeVersionId === 'original'}>Redact</button>
                  ) : (
                    <button className="card-btn" onClick={(e) => handleRem(r, e.currentTarget)} disabled={activeVersionId === 'original'}>Remove</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="help-icon">
        ?
        <div className="legend-popup">
          <div className="legend-item"><div className="legend-box lb-high"></div> High Confidence (&gt;75%) / User Added</div>
          <div className="legend-item"><div className="legend-box lb-med"></div> Medium Confidence (50-75%)</div>
          <div className="legend-item"><div className="legend-box lb-low"></div> Low Confidence (&lt;50%)</div>
          <div className="legend-item"><div className="legend-box lb-removed"></div> Removal (Red Border)</div>
          <div className="legend-item"><div className="legend-box lb-regex-miss"></div> Regex Miss (Pulsing Red)</div>
          <div className="legend-item"><div className="legend-box lb-risk"></div> Unredacted Risk (Grey Border)</div>
        </div>
      </div>

      {toast && (
        <div className="toast-message">
          {toast}
        </div>
      )}

      {conf && (
        <div className="removal-confirm" style={{ left: conf.x, top: conf.y }}>
          <p>Are you sure?</p>
          <div className="removal-actions">
            <button className="cancel" onClick={() => setConf(null)}>Cancel</button>
            <button onClick={() => tog(conf.id, 'redacted')}>Remove</button>
          </div>
        </div>
      )}

      {sel && (
        <div className="selection-popup" style={{ left: sel.x, top: sel.y }}>
          <div className="selection-row">
            <select value={selT} onChange={(e) => { setSelT(e.target.value); setProx(getAdj(sel.text, doc, reds)); }}>
              {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <button onClick={() => handleAdd(sel.text, selT)}>Redact</button>
          </div>
          {prox.length > 0 && (
            <div className="proximity-hint">
              {prox.map(p => (
                <button key={p} onClick={() => handleAddMulti([sel.text, p], selT)}>Redact "{p}" too?</button>
              ))}
            </div>
          )}
        </div>
      )}

      {expState === 'collision' && (
        <div className="modal-overlay">
          <div className="modal">
            <h2 style={{ color: '#dc2626' }}>Inconsistency Alert</h2>
            <p>The following entities have conflicting states. They are redacted in some places but left visible in others. You must resolve these internal collisions before exporting.</p>
            <div className="modal-list" style={{ marginTop: '16px' }}>
              {exportCollisions.map((text, i) => (
                <div key={i} className="modal-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="modal-item-text"><strong>{text}</strong></div>
                  <button
                    className="btn-solid"
                    style={{ padding: '6px 12px', fontSize: '12px', marginLeft: '12px' }}
                    onClick={async () => {
                      const visibleExisting = reds.filter(r => r.text === text && r.status === 'visible');
                      for (const vItem of visibleExisting) {
                        if (vItem.id) await tog(vItem.id, 'visible');
                      }

                      const safeTxt = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                      const isWord = /^\w+$/.test(text);
                      const regex = isWord ? new RegExp(`\\b${safeTxt}\\b`, 'g') : new RegExp(safeTxt, 'g');
                      const docCount = [...doc.matchAll(regex)].length;
                      const trackingCount = reds.filter(r => r.text === text).length;

                      for (let j = 0; j < (docCount - trackingCount); j++) {
                        await add(text, 'OTHER');
                      }

                      const remaining = exportCollisions.filter((_, index) => index !== i);
                      setExportCollisions(remaining);

                      if (remaining.length === 0) {
                        setExpState(null);
                        doExp(exportFormat);
                      }
                    }}
                  >
                    Redact All
                  </button>
                </div>
              ))}
            </div>
            <p style={{ fontSize: '13px', color: '#6d7383', marginTop: '12px' }}>* Resolve all items above to proceed with export.</p>
            <div className="modal-footer">
              <button className="btn-outline" onClick={() => setExpState(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {expState === 'confirm' && (
        <div className="modal-overlay">
          <div className="modal">
            <h2 style={{ color: '#b45309' }}>High-Risk Warning</h2>
            <p>You are attempting to export a document with high-risk text (e.g. &gt;75% confidence or a Regex fallback miss) left unredacted.</p>
            <div className="modal-list" style={{ marginTop: '16px', marginBottom: '24px' }}>
              {exportHighRisks.map((item, i) => (
                <div key={i} className="modal-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="modal-item-text">{item.text} <span>({item.type})</span></div>
                  <button
                    className="btn-solid"
                    style={{ padding: '6px 12px', fontSize: '12px', marginLeft: '12px' }}
                    onClick={async () => {
                      if (item.id) {
                        await tog(item.id, 'visible');
                      } else {
                        await add(item.text, item.type);
                      }

                      const remainingRisks = exportHighRisks.filter((_, index) => index !== i);
                      setExportHighRisks(remainingRisks);

                      if (remainingRisks.length === 0) {
                        proceedExp();
                      }
                    }}
                  >
                    Redact Immediately
                  </button>
                </div>
              ))}
            </div>
            {exportHighRisks.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px' }}>
                <label style={{ fontSize: '14px', fontWeight: 500 }}>Type "Confirm" to proceed anyway:</label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="Confirm"
                  style={{ padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
                />
              </div>
            )}
            <div className="modal-footer">
              <button className="btn-outline" onClick={() => setExpState(null)}>Cancel</button>
              <button
                className="btn-solid"
                disabled={confirmText !== 'Confirm' && exportHighRisks.length > 0}
                onClick={proceedExp}
                style={{ background: confirmText === 'Confirm' || exportHighRisks.length === 0 ? '#0a0b0d' : '#9ca3af' }}
              >
                Proceed to Export
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}