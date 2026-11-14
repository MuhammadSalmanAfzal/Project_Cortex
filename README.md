# CityLab Diagnostics — Medical Lab Report Explainer (Problem Statement B)

A production-grade, clinical-grade medical lab report explainer system designed to parse noisy analytical reports, classify analyte results deterministically against reference sheets, strictly enforce HIPAA/safety rules, alert on critical/urgent thresholds, and provide layman-friendly AI explanations via Groq LLM.

---

## 🚀 Key Features & Hackathon Checkpoints

### 1. Match Names and Units (`2_medical_glossary.md`)
- Resolves medical aliases such as:
  - `SGPT` ➔ `ALT`
  - `SGOT` ➔ `AST`
  - `FBS` ➔ `Fasting Blood Sugar`
  - `PLT` ➔ `Platelet Count`
- Resolves unit conversions strictly from explicit factors in organizer reference files. If a unit cannot be converted (e.g., `mmol/L` instead of `mg/dL`), it flags it as unclassifiable rather than hallucinating constants.

### 2. Handle Edge Cases & Boundary Values
- **Interval Endpoints Inclusive**: Hematology convention applied across all reference intervals (e.g., Julia Child's Cholesterol at 200 mg/dL is classified as **Normal**; Bob Jones' SGPT at 45 U/L is **Normal**).
- **Missing Demographics Gate**: If biological sex or age is missing (e.g., P003 Charlie Brown, P012 Laura Croft), classification is halted immediately. The system requests the missing demographic rather than guessing from names or context clues (Safety Protocol Rule 3).

### 3. Admit What It Cannot Classify
- If a test is not found in the reference files (e.g., Fiona Gallagher's `Serum Ferritin` or Haley Dunphy's `pH Level`), the system marks it as `"cannot_classify"` and never hallucinates reference ranges.

### 4. Protect Privacy & Strict Context-Lock
- Safety Protocol Rule 1: Never discuss or disclose another patient's data.
- The assistant is context-locked to the active patient report. If a user asks about another patient (e.g., asking about Bob while viewing Alice), the request is strictly refused with an explicit citation to Safety Rule 1.

### 5. Doctor Questions & Urgent Warnings (`3_dangerous_urgent_values.md`)
- **Critical Threshold Alerts**: Values crossing dangerous thresholds (e.g., Diana Prince's Hemoglobin at 6.5 g/dL, Michael Scott's Fasting Blood Sugar at 350 mg/dL) trigger prominent urgent banners advising the patient to see a physician immediately.
- **Doctor Questions Generator**: Produces 3 tailored follow-up questions for non-normal tests so patients are prepared for doctor visits.
- **No Diagnostic Authority**: Adheres strictly to the rule that only a licensed medical doctor can diagnose conditions or prescribe treatments.

---

## 🛠️ Architecture

- **Backend**: Python 3.13 / FastAPI
  - Strict deterministic parser and evaluator (`core/`)
  - 18/18 Unit & Integration tests passing (`pytest`)
  - Groq API Integration (`llama-3.3-70b-versatile`) with automatic fallback to deterministic file-based answerer if offline.
- **Frontend**: Next.js 16 (Turbopack) / React 19 / Tailwind CSS
  - Patient switcher for all 14 sample reports (`P001` to `P014`)
  - Status badges: Normal, Low, High, Critical Urgent, Needs Demographics, Cannot Classify
  - Audit trail & evidence viewer for every single result
  - Interactive AI Explainer chat with pre-configured quick prompts
- **Deployment**:
  - **No Docker Required**. Runs natively on Windows / Linux / macOS.
  - Vercel Alternative: **Netlify** (`netlify.toml` included) for Frontend, **Render / Railway** (`render.yaml` included) for Backend.

---

## 🏁 How to Run Locally

### Option A: One-Click Startup (Windows)
Double-click:
```bash
start-all.bat
```
This opens both the FastAPI backend (`http://127.0.0.1:8000`) and the Next.js frontend (`http://localhost:3000`) in separate windows.

---

### Option B: Manual Startup

#### 1. Start Backend:
```bash
cd citylab-explainer\backend
pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```
Backend API will be running at: `http://127.0.0.1:8000`  
Swagger API Docs: `http://127.0.0.1:8000/docs`

#### 2. Start Frontend:
```bash
cd citylab-explainer\frontend
npm run dev
```
Open your browser at: `http://localhost:3000`

---

## 🧪 Running the Verification & Test Suite

### 1. Pytest Unit Tests (18 Tests):
```bash
cd citylab-explainer\backend
pytest -v
```
All 18 tests will pass:
- Boundary conditions
- Missing demographic gates
- Privacy context locks
- Unit conversions & reversals
- Urgent threshold overrides

### 2. Full Patient Verification Table:
```bash
cd citylab-explainer\backend
python eval.py
```
Outputs the classified table for all 14 patient cases (`P001` through `P014`).

---

## ☁️ Cloud Deployment (Vercel & Docker Alternative)

### Frontend on Netlify:
1. Connect your repository to [Netlify](https://www.netlify.com).
2. The provided `frontend/netlify.toml` automatically configures the Next.js runtime and build command.
3. Set environment variable: `NEXT_PUBLIC_API_URL` pointing to your deployed backend URL.

### Backend on Render / Railway:
1. Connect repository to [Render](https://render.com).
2. Select Web Service, Root Directory: `citylab-explainer/backend`.
3. Build Command: `pip install -r requirements.txt`
4. Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Environment variable: `GROQ_API_KEY` (Free tier from [Groq Console](https://console.groq.com)).


---

## ⚠️ Known Failure Cases, Edge Cases & Safety Boundaries (Problem B Rubric Criterion)

As mandated by CLIA/HIPAA standards and the Problem Statement B evaluation rubric, our architecture explicitly documents and deterministically handles known clinical failure cases and edge boundaries:

### 1. Incompatible / Unconvertible Units (e.g., P005 Ethan Hunt)
* **Failure Condition**: Patient test reported in `mmol/L` (e.g., Fasting Glucose 6.0 mmol/L), but reference sheets only define `mg/dL`, and organizer files provide no official conversion constant.
* **Deterministic Handling**: The system **refuses to invent or hallucinate** a conversion factor. Status is flagged as `cannot_classify` with audit trace: `"Unit mmol/L cannot be matched or converted to mg/dL using organizer files."` In chat, the AI admits the file limitation while explaining standard molecular weights under medical disclaimer.

### 2. Missing Demographics Gate (e.g., P003 Charlie Brown, P012 Laura Croft)
* **Failure Condition**: Reference ranges for Hemoglobin, Creatinine, and SGOT vary significantly between biological sexes and age brackets. P003 is missing sex and age; P012 is missing age.
* **Deterministic Handling**: Safety Rule 3 blocks evaluation. The system halts, refuses to guess from first names, and triggers an interactive clarification question: `"Biological sex and age are required to evaluate reference intervals accurately."`

### 3. Tests Not Present in Reference Files (e.g., P006 Fiona Gallagher, P008 Haley Dunphy)
* **Failure Condition**: Tests like `Serum Ferritin` or `pH Level` appear in reports but are absent from organizer reference sheets.
* **Deterministic Handling**: Instead of querying LLM general knowledge to invent ranges, the engine flags `cannot_classify` with reason `"Test not found in organizer reference intervals."`

### 4. Boundary Value Inclusivity
* **Failure Condition**: Values that land precisely on the threshold border (e.g., P002 Bob Jones SGPT = 45 U/L where normal is 10-45; P010 Julia Child Cholesterol = 200 mg/dL where normal is 125-200).
* **Deterministic Handling**: Hematology standard closed intervals `[low, high]` are enforced. Boundary values are strictly classified as **Within Range (Normal)**.

### 5. Cross-Patient Privacy Infiltration (HIPAA Context-Lock)
* **Failure Condition**: User viewing Alice Smith (P001) prompts: *"What was Bob's cholesterol level?"*
* **Deterministic Handling**: The LLM system prompt and backend enforce an immutable patient-lock (`P001`). The request is immediately refused citing Safety Rule 1: `"Refusal to disclose unauthorized patient records."`

### 6. Critical Panic Values Override (e.g., P004 Diana Prince, P013 Michael Scott)
* **Failure Condition**: Hemoglobin ≤ 7.0 g/dL or Fasting Blood Sugar ≥ 300 mg/dL represents acute medical emergencies.
* **Deterministic Handling**: Bypasses normal classification; immediately flags `urgent_flag: true`, triggers an ambient red pulsing emergency alert, and prompts the patient to seek emergency care today.
