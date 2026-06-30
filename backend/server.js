const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

const DATA_PATH = path.join(__dirname, "mock-data.json");

function loadData() {
    return JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
}

function saveData(data) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

const REGEX_RULES = [
    { type: "PHONE", regex: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b|\(\d{3}\)\s*\d{3}[-.]?\d{4}\b/g },
    { type: "EMAIL", regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
    { type: "SSN", regex: /\b\d{3}-\d{2}-\d{4}\b/g }
];

function applyRegexFallback(doc) {
    if (!doc.documentText || !doc.versions) return false;
    let modified = false;

    REGEX_RULES.forEach(rule => {
        let match;
        const re = new RegExp(rule.regex);
        while ((match = re.exec(doc.documentText)) !== null) {
            const matchedText = match[0];
            
            // Apply to all versions if missing
            doc.versions.forEach(version => {
                const exists = version.redactions.some(r => r.text === matchedText);
                if (!exists) {
                    version.redactions.push({
                        id: `regex-miss-${version.id}-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
                        text: matchedText,
                        type: rule.type,
                        confidence: 1.0,
                        status: "visible", 
                        isRegexMiss: true
                    });
                    modified = true;
                }
            });
        }
    });
    return modified;
}

// Run fallback on startup
const initialData = loadData();
let anyModified = false;
Object.values(initialData).forEach(doc => {
    if (applyRegexFallback(doc)) anyModified = true;
});
if (anyModified) saveData(initialData);

// GET all available docs
app.get("/api/documents", (req, res) => {
    const data = loadData();
    res.json(Object.keys(data).map(k => ({
        id: k,
        title: data[k].title || k
    })));
});

// GET specific document
app.get("/api/document/:docId", (req, res) => {
    const data = loadData();
    const doc = data[req.params.docId] || data["api"];
    res.json(doc);
});

// GET the default document
app.get("/api/document", (req, res) => {
    const data = loadData();
    res.json(data["api"]);
});

// Helper to get the correct version array
function getVersionRedactions(doc, versionId) {
    if (!doc.versions) return doc.redactions; // fallback for older structure if any
    const v = doc.versions.find(ver => ver.id === versionId) || doc.versions.find(ver => ver.id === 'current');
    return v ? v.redactions : [];
}

// PATCH: toggle a single redaction's status
app.patch("/api/document/:docId/redactions/:id", (req, res) => {
    const { docId, id } = req.params;
    const { status, versionId = 'current' } = req.body; 

    if (versionId === 'original') {
        return res.status(403).json({ error: "Cannot modify original version" });
    }

    if (!["redacted", "visible"].includes(status)) {
        return res.status(400).json({ error: "status must be 'redacted' or 'visible'" });
    }

    const data = loadData();
    const doc = data[docId] || data["api"];
    const redactions = getVersionRedactions(doc, versionId);
    
    const span = redactions.find((r) => r.id === id);
    if (!span) return res.status(404).json({ error: "redaction not found" });

    span.status = status;
    span.source = "manual"; 
    saveData(data);
    res.json(span);
});

// POST: add a brand new redaction
app.post("/api/document/:docId/redactions", (req, res) => {
    const { docId } = req.params;
    const { text, type, versionId = 'current' } = req.body;
    
    if (versionId === 'original') {
        return res.status(403).json({ error: "Cannot modify original version" });
    }

    if (!text || !type) {
        return res.status(400).json({ error: "text and type are required" });
    }

    const data = loadData();
    const doc = data[docId] || data["api"];
    const redactions = getVersionRedactions(doc, versionId);

    const newSpan = {
        id: `manual-${Date.now()}`,
        text,
        type,
        confidence: 1.0,
        status: "redacted",
        source: "manual",
    };
    redactions.push(newSpan);
    saveData(data);
    res.status(201).json(newSpan);
});

// POST: create a new version
app.post("/api/document/:docId/versions", (req, res) => {
    const { docId } = req.params;
    const { sourceVersionId = 'current' } = req.body;
    
    const data = loadData();
    const doc = data[docId] || data["api"];
    
    if (!doc.versions) {
        return res.status(400).json({ error: "Document does not support versions" });
    }

    const sourceVersion = doc.versions.find(v => v.id === sourceVersionId) || doc.versions.find(v => v.id === 'current');
    
    const newVersionId = `v-${Date.now()}`;
    // Determine a name for the new version
    const count = doc.versions.filter(v => v.id !== 'original' && v.id !== 'current').length;
    const newVersionName = `Version ${count + 1}`;

    const newVersion = {
        id: newVersionId,
        name: newVersionName,
        redactions: JSON.parse(JSON.stringify(sourceVersion.redactions)) // Deep copy
    };

    doc.versions.push(newVersion);
    saveData(data);
    res.status(201).json(newVersion);
});

// POST: restore a version to original
app.post("/api/document/:docId/versions/:versionId/restore", (req, res) => {
    const { docId, versionId } = req.params;
    
    if (versionId === 'original') {
        return res.status(400).json({ error: "Cannot restore the original version" });
    }

    const data = loadData();
    const doc = data[docId] || data["api"];
    
    const targetVersion = doc.versions.find(v => v.id === versionId);
    const originalVersion = doc.versions.find(v => v.id === 'original');

    if (!targetVersion || !originalVersion) {
        return res.status(404).json({ error: "Version not found" });
    }

    targetVersion.redactions = JSON.parse(JSON.stringify(originalVersion.redactions));
    saveData(data);
    res.json(targetVersion);
});

// DELETE: remove a custom version
app.delete("/api/document/:docId/versions/:versionId", (req, res) => {
    const { docId, versionId } = req.params;
    
    if (versionId === 'original') {
        return res.status(400).json({ error: "Cannot delete the original version" });
    }

    const data = loadData();
    const doc = data[docId] || data["api"];
    
    if (!doc.versions) return res.status(404).json({ error: "Versions not found" });

    const idx = doc.versions.findIndex(v => v.id === versionId);
    if (idx === -1) {
        return res.status(404).json({ error: "Version not found" });
    }
    
    doc.versions.splice(idx, 1);
    saveData(data);
    res.json({ success: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Mock PII backend running at http://localhost:${PORT}`);
});