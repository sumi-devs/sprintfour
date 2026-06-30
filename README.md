# CONSEAL PII REDACTION CONFIRMATION TOOL

**SUMITHRA S - CB.SC.U4CSE23749**

Problem 3: Sam is moving fast and trusts the tool a little too much, so mistakes like false positives and false negatives slip through. I built this to break his autopilot but keep manual corrections fast.

https://github.com/user-attachments/assets/78387ae4-69f3-4a1f-8d41-f15bd64387fc

## Features

- **Colour-coded redactions**: High positive score (>75) is hard black, medium (50-75) is dark blue, and low (<50) is yellow. User added redactions are black. Removals get a translucent red border.
- **On hover**, solid black redactions turn translucent so you can see what is underneath.
- **Hovering** also shows quick "redact" and "remove" buttons.
- **Sidebar** on the right containing lists of risks, all redactions and all removals as an easy to review collection. It orders everything from highest risk to lowest.
- **Inconsistency checking**: If you redact "John" somewhere but miss it somewhere else, it gets highlighted to maintain consistency.
- **Proximity scanning**: If you manually redact a word, it highlights the word before and after and asks whether to redact those too.
- **Versioning** of text so you can have multiple versions with different redactions if needed.
- **Actual hashed/redacted export** in txt and pdf formats (using jspdf).

## Handling Export Friction

Missed positives and redacted negatives happen because Sam does not stop to look.

- Before exporting, if you choose not to redact something with a 75-100 confidence score, it asks "are you sure?".
- It shows a list of those high confidence texts with tick and cross boxes next to them to easily redact.
- If any high-risk text is intentionally left unredacted, you have to type "Confirm" before exporting. This forces him to actually stop and look.

## What I Chose Not to Build

- **No global "approve all" button.** Sam would just click it and skip the review entirely.
- **No right-click context menus.** Keeping actions on-hover and in the sidebar respects his speed, while the export friction stops him only when he is about to make a real mistake.
- **No actual cloud LLM backend**, only a mock version with mock data to focus more on the features I wanted to implement since this problem is very frontend and UI/UX heavy.
