import { useState, useEffect, useCallback, useRef } from 'react';

const API = 'http://localhost:3001';

const REDACTION_TYPES = ['PERSON', 'PHONE', 'EMAIL', 'DATE', 'MONEY', 'ID_NUMBER', 'OTHER'];

export default function App() {
  const [documentText, setDocumentText] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [redactions, setRedactions] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  // select popup state
  const [selection, setSelection] = useState(null); // { text, x, y }
  const [selectedType, setSelectedType] = useState(REDACTION_TYPES[0]);

  const viewerRef = useRef(null);

  const fetchDocument = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(`${API}/api/document`);
      if (!res.ok) throw new Error(`GET /api/document failed: ${res.status}`);
      const data = await res.json();
      setDocumentId(data.documentId);
      setDocumentText(data.documentText);
      setRedactions(data.redactions);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocument();
  }, [fetchDocument]);

  const toggleRedaction = async (id, currentStatus) => {
    const newStatus = currentStatus === 'redacted' ? 'visible' : 'redacted';
    try {
      const res = await fetch(`${API}/api/document/redactions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
      const updated = await res.json();
      setRedactions((prev) =>
        prev.map((r) => (r.id === id ? { ...r, ...updated } : r))
      );
    } catch (err) {
      setError(err.message);
    }
  };

  const addRedaction = async (text, type) => {
    try {
      const res = await fetch(`${API}/api/document/redactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, type }),
      });
      if (!res.ok) throw new Error(`POST failed: ${res.status}`);
      const created = await res.json();
      setRedactions((prev) => [...prev, created]);
      setSelection(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleMouseUp = () => {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';

    if (!text || text.length === 0) {
      return;
    }

    if (
      viewerRef.current &&
      sel.anchorNode &&
      viewerRef.current.contains(sel.anchorNode)
    ) {
      // if this text is already a redaction
      const alreadyRedacted = redactions.some((r) => r.text === text);
      if (alreadyRedacted) return;

      // popup near the selection
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setSelection({
        text,
        x: rect.left + window.scrollX,
        y: rect.bottom + window.scrollY + 4,
      });
      setSelectedType(REDACTION_TYPES[0]);
    }
  };

  // clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (selection && !e.target.closest('.selection-popup')) {
        // small delay - mouseup conflict bug
        setTimeout(() => {
          const sel = window.getSelection();
          if (!sel || sel.toString().trim().length === 0) {
            setSelection(null);
          }
        }, 100);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selection]);

  const buildAnnotatedDocument = () => {
    if (!documentText) return null;

    // Sort redactions by their position in the text so we can build segments
    // in order. Only include redactions whose text actually appears in documentText.
    const positioned = redactions
      .map((r) => {
        const idx = documentText.indexOf(r.text);
        return idx >= 0 ? { ...r, startIdx: idx, endIdx: idx + r.text.length } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.startIdx - b.startIdx);

    // keep first occurrence, skip overlaps
    const nonOverlapping = [];
    let lastEnd = 0;
    for (const r of positioned) {
      if (r.startIdx >= lastEnd) {
        nonOverlapping.push(r);
        lastEnd = r.endIdx;
      }
    }

    const segments = [];
    let cursor = 0;

    for (const r of nonOverlapping) {
      // text before this redaction
      if (cursor < r.startIdx) {
        segments.push(
          <span key={`plain-${cursor}`}>
            {documentText.slice(cursor, r.startIdx)}
          </span>
        );
      }

      // redacted/visible span
      const isRedacted = r.status === 'redacted';
      segments.push(
        <span
          key={r.id}
          className={isRedacted ? 'redacted-span' : 'visible-span'}
          onClick={() => toggleRedaction(r.id, r.status)}
          title={`Click to ${isRedacted ? 'reveal' : 'redact'}`}
        >
          {r.text}
          <span className="span-tooltip">
            {r.type} | {r.status} | conf: {r.confidence}
            {r.source ? ` | ${r.source}` : ''}
          </span>
        </span>
      );

      cursor = r.endIdx;
    }

    // plain text
    if (cursor < documentText.length) {
      segments.push(
        <span key={`plain-${cursor}`}>
          {documentText.slice(cursor)}
        </span>
      );
    }

    return segments;
  };

  if (loading) return <p>Loading document…</p>;
  if (error) return <p className="error">Error: {error}</p>;

  return (
    <div>
      <h1>PII Correction Tool</h1>
      <p>Document: <strong>{documentId}</strong></p>
      <p style={{ fontSize: '12px', color: '#666', marginBottom: 8 }}>
        Click a highlighted span to toggle its status. Select text to add a new redaction.
      </p>

      <div
        className="document-viewer"
        ref={viewerRef}
        onMouseUp={handleMouseUp}
      >
        {buildAnnotatedDocument()}
      </div>

      {selection && (
        <div
          className="selection-popup"
          style={{
            left: selection.x,
            top: selection.y,
          }}
        >
          <span>Redact "<strong>{selection.text.length > 30 ? selection.text.slice(0, 30) + '…' : selection.text}</strong>"</span>
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
          >
            {REDACTION_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <button onClick={() => addRedaction(selection.text, selectedType)}>
            Confirm
          </button>
          <button onClick={() => setSelection(null)}>✕</button>
        </div>
      )}

      <h2>Redactions ({redactions.length})</h2>
      <table className="redactions-table">
        <thead>
          <tr>
            <th>Text</th>
            <th>Type</th>
            <th>Confidence</th>
            <th>Status</th>
            <th>Source</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {redactions.map((r) => (
            <tr key={r.id}>
              <td>{r.text}</td>
              <td>{r.type}</td>
              <td>{r.confidence}</td>
              <td>{r.status}</td>
              <td>{r.source || '—'}</td>
              <td>
                <button onClick={() => toggleRedaction(r.id, r.status)}>
                  {r.status === 'redacted' ? 'Reveal' : 'Redact'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
