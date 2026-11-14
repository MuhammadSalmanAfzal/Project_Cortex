"""CityLab Diagnostics - FastAPI Backend with Groq (Primary) and Gemini (Fallback) LLM integration."""

from __future__ import annotations

import os
import sys
import re
from pathlib import Path
from functools import lru_cache
from typing import Literal
from decimal import Decimal

# Ensure the backend directory is on the path so 'core' imports work
sys.path.insert(0, str(Path(__file__).parent))

# Load environment variables from .env file
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from groq import Groq
import httpx

from core.ingest import load_corpus, _strip_md, _cell, _number, _parse_value_and_unit, _parse_sex
from core.service import analyze_patient, answer_question
from core.models import Corpus, PatientReport, LabResult
from core.classify import classify_result
from core.names import canonical_name
from core.ranges import supported_age_bounds

app = FastAPI(title="CityLab Diagnostics API", version="1.0.0")

# CORS - allow all origins for local dev; tighten in production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = Path(__file__).parent / "lab_reports"
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")


@lru_cache(maxsize=1)
def get_corpus() -> Corpus:
    return load_corpus(DATA_DIR)


def get_groq_client() -> Groq | None:
    key = os.environ.get("GROQ_API_KEY", GROQ_API_KEY)
    if not key:
        return None
    try:
        return Groq(api_key=key)
    except Exception:
        return None


# ─── Request / Response Models ───────────────────────────────────────────────

class PatientListResponse(BaseModel):
    patients: list[dict]


class AnalyzeRequest(BaseModel):
    patient_id: str
    override_age: int | None = None
    override_sex: Literal["male", "female"] | None = None


class CustomReportRequest(BaseModel):
    text: str
    override_age: int | None = None
    override_sex: Literal["male", "female"] | None = None


class ChatRequest(BaseModel):
    patient_id: str
    message: str
    history: list[dict] = []
    override_age: int | None = None
    override_sex: Literal["male", "female"] | None = None
    language: str = "english"


class ChatResponse(BaseModel):
    reply: str
    refused: bool = False
    urgent_warnings: list[dict] = []
    used_model: str = "groq-qwen3.8-27b"


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _custom_analyze_patient(
    patient_id: str,
    corpus: Corpus,
    override_age: int | None = None,
    override_sex: Literal["male", "female"] | None = None,
) -> dict:
    """Analyze patient, supporting user-provided missing demographics."""
    key = patient_id.strip().upper()
    patient = corpus.patients.get(key)
    if patient is None:
        raise KeyError(f"Unknown patient ID: {patient_id}")

    age = override_age if override_age is not None else patient.age
    sex = override_sex if override_sex is not None else patient.sex

    missing = []
    if age is None:
        missing.append("age")
    if sex is None:
        missing.append("biological sex at birth")

    if missing:
        # Demographics still missing
        return analyze_patient(key, corpus)

    # Re-evaluate with supplied demographics
    bounds = supported_age_bounds(corpus)
    age_outside = bool(bounds and age is not None and not (bounds[0] <= age <= bounds[1]))
    rows: list[dict] = []
    cannot: list[dict] = []

    for item in patient.results:
        if age_outside:
            canonical = canonical_name(item.original_name, corpus)
            reason = f"Age {age} is outside the age bands supported by the files ({bounds[0]}-{bounds[1]} years)."
            row = {
                "original_name": item.original_name,
                "canonical_name": canonical,
                "value": item.value,
                "original_unit": item.unit,
                "converted_value": item.value,
                "converted_unit": item.unit,
                "conversion_shown": None,
                "range_used": None,
                "status": "cannot_classify",
                "urgent_flag": False,
                "trace": ["Age-band validation: no source range covers this age."],
                "explanation": "This result cannot be classified from the files because the patient's age is outside every listed age band.",
                "reason": reason,
            }
        else:
            row = classify_result(item.original_name, item.value, item.unit, age, sex, corpus)
        rows.append(row)
        if row["status"] == "cannot_classify":
            cannot.append({"test": row["original_name"], "reason": row["reason"]})

    urgent_warnings = [
        {"test": row["canonical_name"], "message": "A result crossed a critical limit listed in the files. Please see a doctor today."}
        for row in rows if row["urgent_flag"]
    ]
    non_normal = [row for row in rows if row["status"] in {"low", "high", "urgent", "cannot_classify"}]
    questions: list[str] = []
    if non_normal:
        for row in non_normal[:3]:
            questions.append(f"Could you explain how {row['original_name']} compares with the information in the report?")
        while len(questions) < 3:
            questions.append("What follow-up, if any, do you recommend for these results?")

    return {
        "patient_id": patient.patient_id,
        "patient_name": patient.name,
        "age": age,
        "biological_sex": sex,
        "source_file": patient.source_file,
        "needs_clarification": False,
        "clarification_question": None,
        "tests": rows,
        "cannot_classify": cannot,
        "doctor_questions": questions,
        "urgent_warnings": urgent_warnings,
        "disclaimer": "This tool compares results with the supplied files and does not diagnose. Only a licensed doctor can diagnose.",
    }


def _parse_custom_report_text(text: str, override_age: int | None = None, override_sex: str | None = None) -> PatientReport:
    """Parse a user-submitted markdown report string."""
    clean_text = re.split(r"(?im)^\s*###\s*APPENDIX\b", text, maxsplit=1)[0]
    
    def field(label: str) -> str | None:
        label_pattern = re.compile(rf"^{label}\s*:\s*(.*?)\s*$", re.I)
        for source_line in clean_text.splitlines():
            candidate = _strip_md(source_line).lstrip("*- ").strip()
            match = label_pattern.match(candidate)
            if match:
                return match.group(1).strip()
        return None

    name = field(r"Patient Full Name") or "Custom Patient"
    age_raw = field(r"Recorded Age")
    age_match = re.fullmatch(r"\d+", age_raw or "")
    age = override_age if override_age is not None else (int(age_match.group()) if age_match else None)
    sex_raw = field(r"Biological Sex")
    sex = override_sex if override_sex is not None else _parse_sex(sex_raw)

    result_section = re.split(r"(?im)^\s*##\s*SECTION III:\s*ANALYTICAL RESULTS\s*$", clean_text, maxsplit=1)
    result_text = result_section[1] if len(result_section) == 2 else clean_text
    results: list[LabResult] = []

    for line_number, line in enumerate(result_text.splitlines(), 1):
        stripped = line.strip()
        if not stripped:
            continue
        # Check for bullets: - Hemoglobin: 13.5 g/dL
        bullet_match = re.match(r"^[-*]\s*([^:]+?)\s*:\s*(.+)$", stripped)
        if bullet_match:
            t_name = _strip_md(bullet_match.group(1))
            val_unit = _parse_value_and_unit(bullet_match.group(2))
            if val_unit:
                results.append(LabResult(original_name=t_name, value=val_unit[0], unit=val_unit[1], line=line_number))
                continue
        # Table rows: | Test | Value | Unit |
        if stripped.startswith("|") and not re.search(r"---", stripped):
            cells = [_cell(c) for c in stripped.strip("|").split("|")]
            if len(cells) >= 2 and not any(k in cells[0].lower() for k in ["test", "analyte"]):
                val_unit = _parse_value_and_unit(cells[1])
                if val_unit:
                    u = cells[2] if len(cells) >= 3 else val_unit[1]
                    results.append(LabResult(original_name=cells[0], value=val_unit[0], unit=u, line=line_number))

    return PatientReport(
        patient_id="CUSTOM",
        name=name,
        age=age,
        sex=sex,
        source_file="custom_submission.md",
        results=results,
    )


def _build_system_prompt(analysis: dict, language: str = "english") -> str:
    """Build a detailed system prompt strictly adhering to CityLab rules."""
    patient_name = analysis.get("patient_name", "Unknown")
    patient_id = analysis.get("patient_id", "")
    age = analysis.get("age", "unknown")
    sex = analysis.get("biological_sex", "unknown")

    tests_summary = []
    for t in analysis.get("tests", []):
        status_emoji = {
            "normal": "✅",
            "low": "⬇️",
            "high": "⬆️",
            "urgent": "🚨",
            "cannot_classify": "❓",
            "needs_clarification": "❔",
        }.get(t["status"], "")
        line = (
            f"  - {t['original_name']}"
            + (f" ({t['canonical_name']})" if t.get("canonical_name") and t["canonical_name"] != t["original_name"] else "")
            + f": {t['value']} {t.get('original_unit', '')}"
            + f" → {status_emoji} {t['status'].upper()}"
            + (f" (Reference Range: {t['range_used']['low']}–{t['range_used']['high']} {t.get('converted_unit','')})" if t.get("range_used") and t["range_used"].get("low") is not None else "")
            + f"\n    Explanation: {t.get('explanation', '')}"
        )
        tests_summary.append(line)

    urgent_lines = []
    for w in analysis.get("urgent_warnings", []):
        urgent_lines.append(f"  🚨 URGENT: {w['test']} — {w['message']}")

    cannot_lines = []
    for c in analysis.get("cannot_classify", []):
        cannot_lines.append(f"  - {c['test']}: {c['reason']}")

    lang_instruction = "Respond in clear English in simple layman terms."
    if "urdu" in language.lower() and "roman" in language.lower():
        lang_instruction = "Respond in polite, conversational Roman Urdu (Urdu written in English script) so Pakistani patients can easily understand."
    elif "urdu" in language.lower():
        lang_instruction = "Respond in fluent, natural Urdu script (اردو) in simple, accessible language."

    prompt_parts = [
        "You are CityLab Diagnostics AI, an empathetic, clinical-grade medical lab report explainer.",
        f"LANGUAGE DIRECTIVE: {lang_instruction}",
        "",
        "MANDATORY CLINICAL SAFETY DIRECTIVES (VIOLATION RESULTS IN DISQUALIFICATION):",
        "1. NEVER DIAGNOSE. Never say 'you have condition X'. Only state what the numbers indicate relative to lab intervals.",
        "2. CONTEXT-LOCK PRIVACY. You may only discuss the active patient's report. If asked about another person/patient, REFUSE explicitly citing Rule 1.",
        "3. MISSING DEMOGRAPHICS PROTOCOL. If age or biological sex is missing, you must ask the patient to provide them; never guess.",
        "4. DO NOT HALLUCINATE RANGES. If a test cannot be classified from the files (e.g. Ferritin or unsupported unit), explicitly state that it cannot be classified from the files.",
        "5. CRITICAL/URGENT PROTOCOL. If any value is marked urgent or dangerous, urge the user clearly to seek immediate physician care today.",
        "6. LAYMAN EXPLANATIONS. Explain what tests reflect in plain English/Urdu without condescension.",
        "7. ALWAYS INCLUDE DISCLAIMER. Remind the user that only a licensed medical doctor can diagnose or prescribe.",
        "",
        f"ACTIVE PATIENT PROFILE:",
        f"• Patient Name: {patient_name}",
        f"• Patient ID: {patient_id}",
        f"• Age: {age}",
        f"• Biological Sex: {sex}",
        "",
        "PARSED TEST RESULTS:",
    ]
    prompt_parts.extend(tests_summary)

    if urgent_lines:
        prompt_parts.append("")
        prompt_parts.append("⚠️ CRITICAL ALERTS ACTIVE:")
        prompt_parts.extend(urgent_lines)

    if cannot_lines:
        prompt_parts.append("")
        prompt_parts.append("UNCLASSIFIED TESTS:")
        prompt_parts.extend(cannot_lines)

    if analysis.get("needs_clarification"):
        prompt_parts.append("")
        prompt_parts.append(f"DEMOGRAPHIC CLARIFICATION REQUIRED: {analysis.get('clarification_question', '')}")

    prompt_parts.extend([
        "",
        f"STANDARD DISCLAIMER: {analysis.get('disclaimer', '')}",
        "",
        "Provide direct, structured answers with bullet points.",
    ])

    return "\n".join(prompt_parts)


# ─── Routes ──────────────────────────────────────────────────────────────────

@app.get("/")
@app.get("/api")
def root():
    return {
        "status": "CityLab Diagnostics API is running",
        "version": "1.0.0",
        "endpoints": ["/patients", "/analyze", "/analyze-custom", "/chat", "/health"],
    }


@app.get("/patients", response_model=PatientListResponse)
@app.get("/api/patients", response_model=PatientListResponse)
def list_patients():
    corpus = get_corpus()
    patients = []
    for pid, report in corpus.patients.items():
        patients.append({
            "patient_id": pid,
            "name": report.name,
            "age": report.age,
            "sex": report.sex,
            "source_file": report.source_file,
            "result_count": len(report.results),
        })
    return {"patients": sorted(patients, key=lambda x: x["patient_id"])}


@app.post("/analyze")
@app.post("/api/analyze")
def analyze(req: AnalyzeRequest):
    corpus = get_corpus()
    try:
        if req.override_age is not None or req.override_sex is not None:
            return _custom_analyze_patient(req.patient_id, corpus, req.override_age, req.override_sex)
        return analyze_patient(req.patient_id, corpus)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/analyze-custom")
@app.post("/api/analyze-custom")
def analyze_custom(req: CustomReportRequest):
    corpus = get_corpus()
    patient = _parse_custom_report_text(req.text, req.override_age, req.override_sex)
    if not patient.results:
        raise HTTPException(status_code=400, detail="No valid test results found in custom markdown report.")
    
    # Analyze against corpus
    temp_corpus = Corpus(
        patients={patient.patient_id: patient},
        ranges=corpus.ranges,
        urgent_thresholds=corpus.urgent_thresholds,
        aliases=corpus.aliases,
        glossary=corpus.glossary,
        conversions=corpus.conversions,
    )
    return analyze_patient(patient.patient_id, temp_corpus)


@app.post("/chat", response_model=ChatResponse)
@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    corpus = get_corpus()

    # Get patient analysis
    try:
        if req.override_age is not None or req.override_sex is not None:
            analysis = _custom_analyze_patient(req.patient_id, corpus, req.override_age, req.override_sex)
        else:
            analysis = analyze_patient(req.patient_id, corpus)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Patient {req.patient_id} not found.")

    # Check for other-patient privacy violation via deterministic service layer
    qa = answer_question(req.patient_id, req.message, corpus)
    if qa.get("refused"):
        return ChatResponse(
            reply=qa["answer"],
            refused=True,
            urgent_warnings=[],
            used_model="privacy-filter-rule-1",
        )

    system_prompt = _build_system_prompt(analysis, req.language)

    # 1. Primary: Groq LLM (High-speed open source inference approved by rules)
    groq_client = get_groq_client()
    if groq_client is not None:
        try:
            messages = [{"role": "system", "content": system_prompt}]
            for turn in req.history[-8:]:
                if turn.get("role") in ("user", "assistant"):
                    messages.append({"role": turn["role"], "content": turn["content"]})
            messages.append({"role": "user", "content": req.message})

            completion = groq_client.chat.completions.create(
                model="qwen/qwen3.8-27b",
                messages=messages,
                temperature=0.2,
                max_tokens=800,
            )
            reply = completion.choices[0].message.content
            if reply and reply.strip():
                return ChatResponse(
                    reply=reply.strip(),
                    refused=False,
                    urgent_warnings=analysis.get("urgent_warnings", []),
                    used_model="groq-qwen3.8-27b",
                )
        except Exception:
            pass

    # 2. Secondary Fallback: Gemini API
    gemini_key = os.environ.get("GEMINI_API_KEY", GEMINI_API_KEY)
    if gemini_key:
        try:
            url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent"
            payload = {
                "system_instruction": {"parts": [{"text": system_prompt}]},
                "contents": [{"parts": [{"text": req.message}]}],
            }
            with httpx.Client(timeout=10.0) as http_client:
                resp = http_client.post(
                    url,
                    headers={"x-goog-api-key": gemini_key, "Content-Type": "application/json"},
                    json=payload,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    candidate = data.get("candidates", [{}])[0]
                    text_parts = candidate.get("content", {}).get("parts", [{}])
                    gemini_reply = text_parts[0].get("text", "")
                    if gemini_reply.strip():
                        return ChatResponse(
                            reply=gemini_reply.strip(),
                            refused=False,
                            urgent_warnings=analysis.get("urgent_warnings", []),
                            used_model="gemini-3.8-flash",
                        )
        except Exception:
            pass

    # 3. Deterministic Safety Fallback (Always reliable, 0 hallucination)
    deterministic_answer = qa.get("answer", "I could not find an answer in the reference files.")
    return ChatResponse(
        reply=f"{deterministic_answer}\n\n*Note: Answered using deterministic rules engine from verified corpus files.*",
        refused=False,
        urgent_warnings=analysis.get("urgent_warnings", []),
        used_model="deterministic-rules-engine",
    )


@app.get("/health")
@app.get("/api/health")
def health():
    try:
        corpus = get_corpus()
        return {
            "status": "ok",
            "patients_loaded": len(corpus.patients),
            "ranges_loaded": len(corpus.ranges),
            "groq_configured": bool(os.environ.get("GROQ_API_KEY", GROQ_API_KEY)),
            "gemini_configured": bool(os.environ.get("GEMINI_API_KEY", GEMINI_API_KEY)),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
