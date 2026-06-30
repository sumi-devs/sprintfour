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

// GET all available docs
app.get("/api/documents", (req, res) => {
    const data = loadData();
    res.json(Object.keys(data).map(k => ({
        id: k,
        title: k === 'api' ? 'Account Access Issue' : k === 'mock-1' ? 'Billing Dispute' : 'Refund Request'
    })));
});

// GET specific document
app.get("/api/document/:docId", (req, res) => {
    const data = loadData();
    const doc = data[req.params.docId] || data["api"];
    res.json(doc);
});

// GET the default document (for fallback if they don't specify docId)
app.get("/api/document", (req, res) => {
    const data = loadData();
    res.json(data["api"]);
});

// PATCH: toggle a single redaction's status
app.patch("/api/document/:docId/redactions/:id", (req, res) => {
    const { docId, id } = req.params;
    const { status } = req.body; 

    if (!["redacted", "visible"].includes(status)) {
        return res.status(400).json({ error: "status must be 'redacted' or 'visible'" });
    }

    const data = loadData();
    const doc = data[docId] || data["api"];
    const span = doc.redactions.find((r) => r.id === id);
    if (!span) return res.status(404).json({ error: "redaction not found" });

    span.status = status;
    span.source = "manual"; 
    saveData(data);
    res.json(span);
});

// Fallback for old PATCH endpoint
app.patch("/api/document/redactions/:id", (req, res) => {
    const { id } = req.params;
    const { status } = req.body; 
    const data = loadData();
    const doc = data["api"];
    const span = doc.redactions.find((r) => r.id === id);
    if (!span) return res.status(404).json({ error: "redaction not found" });
    span.status = status;
    span.source = "manual"; 
    saveData(data);
    res.json(span);
});

// POST: add a brand new redaction
app.post("/api/document/:docId/redactions", (req, res) => {
    const { docId } = req.params;
    const { text, type } = req.body;
    if (!text || !type) {
        return res.status(400).json({ error: "text and type are required" });
    }

    const data = loadData();
    const doc = data[docId] || data["api"];
    const newSpan = {
        id: `manual-${Date.now()}`,
        text,
        type,
        confidence: 1.0,
        status: "redacted",
        source: "manual",
    };
    doc.redactions.push(newSpan);
    saveData(data);
    res.status(201).json(newSpan);
});

// Fallback for old POST endpoint
app.post("/api/document/redactions", (req, res) => {
    const { text, type } = req.body;
    const data = loadData();
    const doc = data["api"];
    const newSpan = {
        id: `manual-${Date.now()}`,
        text,
        type,
        confidence: 1.0,
        status: "redacted",
        source: "manual",
    };
    doc.redactions.push(newSpan);
    saveData(data);
    res.status(201).json(newSpan);
});

app.post("/api/document/reset", (req, res) => {
    res.json({ message: "Restart the server to reset to original mock data." });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Mock PII backend running at http://localhost:${PORT}`);
});