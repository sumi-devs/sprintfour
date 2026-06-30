import { useState, useEffect, useCallback, useRef } from 'react';
import jsPDF from 'jspdf';

const API = 'http://localhost:3001';
const TYPES = ['PERSON', 'PHONE', 'EMAIL', 'DATE', 'MONEY', 'ID_NUMBER', 'OTHER'];

// detect type
const guessType = (txt) => {
  if (/\(?\d{3}\)?[-\.\s]?\d{3}[-\.\s]?\d{4}/.test(txt)) return 'PHONE';
  if (/[\w.\+-]+@[\w-]+\.[a-zA-Z]{2,}/.test(txt)) return 'EMAIL';
  if (/^[A-Z][a-z]{2,}(\s[A-Z][a-z]{2,}){0,2}$/.test(txt)) return 'PERSON';
  return 'OTHER';
};

// get adj words
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

// find unredacted
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

export default function App() {
  const [docList, setDocList] = useState([]);
  const [doc, setDoc] = useState('');
  const [docTitle, setDocTitle] = useState('');
  const [id, setId] = useState('');
  const [reds, setReds] = useState([]);
  const [origReds, setOrigReds] = useState(null);
  const [curDocId, setCurDocId] = useState('api');

  // accordion state
  const [openAccordionId, setOpenAccordionId] = useState('api');

  const [tab, setTab] = useState('Risks'); // Risks | Redactions | Removals
  const [leftCol, setLeftCol] = useState(false);
  
  const [conf, setConf] = useState(null);
  const [sel, setSel] = useState(null);
  const [selT, setSelT] = useState(TYPES[0]);
  const [prox, setProx] = useState([]);

  const [expState, setExpState] = useState(null);
  const [expItems, setExpItems] = useState([]);
  const [expDec, setExpDec] = useState({});
  const [quiz, setQuiz] = useState(null);
  const [quizAns, setQuizAns] = useState(null);
  const [exportFormat, setExportFormat] = useState('txt');

  const vRef = useRef(null);

  // load doc list
  const loadDocs = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/documents`);
      const d = await r.json();
      setDocList(d);
    } catch (e) {
      console.log('Failed to fetch doc list');
    }
  }, []);

  // load specific doc
  const loadDoc = useCallback(async (docId) => {
    try {
      const r = await fetch(`${API}/api/document/${docId}`);
      const d = await r.json();
      setId(d.documentId);
      setDocTitle(d.title || d.documentId);
      setDoc(d.documentText.replace(/—/g, '-'));
      setReds(d.redactions);
      setOrigReds(JSON.parse(JSON.stringify(d.redactions)));
      setCurDocId(docId);
      setOpenAccordionId(docId);
      setConf(null);
    } catch (e) {
      console.log('Failed to load doc');
    }
  }, []);

  useEffect(() => { 
    loadDocs();
    loadDoc('api'); 
  }, [loadDocs, loadDoc]);

  // toggle red
  const tog = async (rId, cur) => {
    const n = cur === 'redacted' ? 'visible' : 'redacted';
    try {
      const r = await fetch(`${API}/api/document/${curDocId}/redactions/${rId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: n }),
      });
      const u = await r.json();
      setReds((p) => p.map((x) => (x.id === rId ? { ...x, ...u } : x)));
    } catch (e) {
      setReds((p) => p.map((x) => (x.id === rId ? { ...x, status: n } : x)));
    }
    setConf(null);
  };

  // new red
  const add = async (txt, typ) => {
    try {
      const r = await fetch(`${API}/api/document/${curDocId}/redactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: txt, type: typ }),
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

  // handle select
  const handleUp = () => {
    const s = window.getSelection();
    const t = s ? s.toString().trim() : '';
    if (!t) return;
    if (vRef.current && s.anchorNode && vRef.current.contains(s.anchorNode)) {
      if (reds.some((r) => r.text === t)) return;
      const rg = s.getRangeAt(0);
      const rt = rg.getBoundingClientRect();
      const gt = guessType(t);
      setSel({ text: t, x: rt.left, y: rt.bottom + 4 });
      setSelT(gt);
      setProx(getAdj(t, doc, reds));
    }
  };

  // clear select
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

  // confirm rem
  const askRem = (r, rect) => {
    setConf({ id: r.id, x: rect.left, y: rect.top - 80, item: r });
  };

  // handle rem click from sidebar
  const handleRem = (r, el = null) => {
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

  // handle span click directly
  const handleSpanClick = (e, r) => {
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

  // prep sidebar lists
  const unredactedIssues = getUnredacted(doc, reds);
  const risksList = [];
  reds.forEach(r => { if (r.status === 'visible' && r.confidence >= 0.5) risksList.push(r); });
  
  const unredactedFakeReds = unredactedIssues.map((u, i) => ({
    id: `unr-${i}`, text: u.text, type: u.type, confidence: 1, status: 'visible', isNew: true 
  }));
  risksList.push(...unredactedFakeReds);

  const removalsList = reds.filter(r => {
    const og = origReds?.find(o => o.id === r.id);
    return og && og.status === 'redacted' && r.status === 'visible';
  });

  const redactionsList = reds.filter(r => r.status === 'redacted');

  // get list for current tab
  let curList = [];
  if (tab === 'Risks') curList = risksList;
  else if (tab === 'Redactions') curList = redactionsList;
  else if (tab === 'Removals') curList = removalsList;
  
  curList.sort((a, b) => b.confidence - a.confidence);

  // build spans
  const buildDoc = () => {
    if (!doc) return null;

    // merge real redactions and unredacted issues (risks) so they are ALL highlighted in text
    const allItems = [...reds, ...unredactedFakeReds];
    const pos = allItems.map((r) => {
      const i = doc.indexOf(r.text);
      return i >= 0 ? { ...r, s: i, e: i + r.text.length } : null;
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
        else if (r.confidence >= 0.9) cls += 'redact-high';
        else if (r.confidence >= 0.75) cls += 'redact-high-med';
        else if (r.confidence >= 0.5) cls += 'redact-med';
        else cls += 'redact-low';
      } else {
        cls += isRm ? 'span-removed' : 'span-removed';
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

  // do export
  const doExp = (format) => {
    setExportFormat(format);
    const blk = [];
    reds.forEach((r) => {
      if (r.status === 'visible' && r.confidence >= 0.75) {
        blk.push({ ...r, reason: 'High risk' });
      }
    });
    blk.push(...unredactedIssues);

    if (blk.length > 0) {
      setExpItems(blk);
      setExpDec({});
      setExpState('check');
    } else {
      doQuiz();
    }
  };

  // proc exp
  const procCheck = async () => {
    for (const k of Object.keys(expDec)) {
      if (expDec[k] === 'redact') {
        const item = expItems.find(i => i.id === k || i.text === k);
        if (item) {
          if (item.id) await tog(item.id, 'visible');
          else await add(item.text, item.type);
        }
      }
    }
    doQuiz();
  };

  // do quiz
  const doQuiz = () => {
    setExpState('quiz');
    const lows = reds.filter(r => r.confidence < 0.5);
    const item = lows.length > 0 ? lows[0] : { text: 'Daniel Reyes', type: 'PERSON' };
    setQuiz(item);
    setQuizAns(null);
  };

  // fin exp -> actual file download
  const finExp = () => {
    setExpState(null);
    
    // sort redactions by position to replace correctly
    const pos = reds.map((r) => {
      const i = doc.indexOf(r.text);
      return i >= 0 ? { ...r, s: i, e: i + r.text.length } : null;
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
      const pdf = new jsPDF();
      pdf.setFontSize(12);
      const margin = 15;
      const pageHeight = pdf.internal.pageSize.height;
      const textLines = pdf.splitTextToSize(finalTxt, pdf.internal.pageSize.width - (margin * 2));
      let y = margin;
      for (let i = 0; i < textLines.length; i++) {
        if (y > pageHeight - margin) {
          pdf.addPage();
          y = margin;
        }
        pdf.text(textLines[i], margin, y);
        y += 7;
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
        loadDoc(id);
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
                      <div className="version-item active">Current (Edited)</div>
                      <div className="version-item">Original Version</div>
                    </div>
                  )}
                </div>
              );
            })}

          </div>
        </div>

        <div className="document-pane" ref={vRef} onMouseUp={handleUp}>
          <div className="document-content">
            {buildDoc()}
          </div>
        </div>

        <div className="sidebar">
          <div className="sidebar-header">
            <div className="sidebar-top-row">
              <div className="sidebar-title">Review</div>
              <div className="export-actions">
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
                  <span className={`card-risk ${r.confidence >= 0.75 ? 'risk-high' : r.confidence >= 0.5 ? 'risk-med' : 'risk-low'}`}>
                    {r.confidence >= 0.75 ? 'High Risk' : r.confidence >= 0.5 ? 'Med Risk' : 'Low Risk'}
                  </span>
                </div>
                <div className="card-text">{r.text}</div>
                <div className="card-actions">
                  {r.status === 'visible' ? (
                    <button className="card-btn primary" onClick={() => r.isNew ? add(r.text, r.type) : tog(r.id, 'visible')}>Redact</button>
                  ) : (
                    <button className="card-btn" onClick={() => handleRem(r)}>Remove</button>
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
          <div className="legend-item"><div className="legend-box lb-high"></div> High Confidence (&gt;90%)</div>
          <div className="legend-item"><div className="legend-box lb-med"></div> Medium Confidence (50-75%)</div>
          <div className="legend-item"><div className="legend-box lb-low"></div> Low Confidence (&lt;50%)</div>
          <div className="legend-item"><div className="legend-box lb-risk"></div> Unredacted Risk (Grey Border)</div>
        </div>
      </div>

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

      {expState === 'check' && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>High Risk Exposed</h2>
            <p>Are you sure?</p>
            <div className="modal-list">
              {expItems.map((item, i) => (
                <div key={i} className="modal-item">
                  <div className="modal-item-text">{item.text} <span>({item.type})</span></div>
                  <div className="modal-item-actions">
                    <button className={`tick-btn ${expDec[item.id || item.text] === 'redact' ? 'active' : ''}`} onClick={() => setExpDec({...expDec, [item.id || item.text]: 'redact'})}>✓</button>
                    <button className={`cross-btn ${expDec[item.id || item.text] === 'keep' ? 'active' : ''}`} onClick={() => setExpDec({...expDec, [item.id || item.text]: 'keep'})}>✕</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-footer">
              <button className="btn-outline" onClick={() => setExpState(null)}>Cancel</button>
              <button className="btn-solid" onClick={procCheck}>Continue</button>
            </div>
          </div>
        </div>
      )}

      {expState === 'quiz' && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Quick Review</h2>
            <p>Is this text sensitive?</p>
            <div style={{padding: '16px', background: '#f4f5f7', borderRadius: '8px', marginBottom: '24px'}}>
              <strong>{quiz?.text}</strong>
            </div>
            <div style={{display: 'flex', gap: '20px', marginBottom: '32px'}}>
              <label style={{display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '15px'}}>
                <input type="radio" checked={quizAns === 'yes'} onChange={() => setQuizAns('yes')} /> Yes
              </label>
              <label style={{display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '15px'}}>
                <input type="radio" checked={quizAns === 'no'} onChange={() => setQuizAns('no')} /> No
              </label>
            </div>
            <div className="modal-footer">
              <button className="btn-outline" onClick={() => setExpState(null)}>Cancel</button>
              <button className="btn-solid" disabled={!quizAns} onClick={finExp}>Export {exportFormat.toUpperCase()}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
