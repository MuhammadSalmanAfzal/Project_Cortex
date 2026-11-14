"use client";

import React, { useState, useEffect, useRef } from "react";

interface PatientSummary {
  patient_id: string;
  name: string;
  age: number | null;
  sex: string | null;
  source_file: string;
  result_count: number;
}

interface TestResult {
  original_name: string;
  canonical_name: string | null;
  value: any;
  original_unit: string;
  converted_value: any;
  converted_unit: string;
  conversion_shown: {
    value: any;
    from: string;
    to: string;
    factor: any;
    result: any;
  } | null;
  range_used: {
    low: any;
    high: any;
    age_band: { min: number; max: number };
    sex: string;
    source_file: string;
  } | null;
  status: "normal" | "low" | "high" | "urgent" | "cannot_classify" | "needs_clarification";
  urgent_flag: boolean;
  trace: string[];
  explanation: string;
  reason: string;
}

interface UrgentWarning {
  test: string;
  message: string;
}

interface CannotClassify {
  test: string;
  reason: string;
}

interface PatientAnalysis {
  patient_id: string;
  patient_name: string;
  age: number | null;
  biological_sex: string | null;
  source_file: string;
  needs_clarification: boolean;
  clarification_question: string | null;
  tests: TestResult[];
  cannot_classify: CannotClassify[];
  doctor_questions: string[];
  urgent_warnings: UrgentWarning[];
  disclaimer: string;
}

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  urgent_warnings?: UrgentWarning[];
  refused?: boolean;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

const PRESET_REPORTS: Record<string, string> = {
  "Sarah Connor (Custom Normal CBC)": `# CITYLAB DIAGNOSTICS - CLINICAL REPORT
## SECTION I: PATIENT DEMOGRAPHICS
* **Patient Full Name**: Sarah Connor
* **Recorded Age**: 34
* **Biological Sex**: Female
* **Medical Record Number (MRN)**: CLD-CUSTOM-102
* **Date of Issuance**: 2026-11-14

## SECTION III: ANALYTICAL RESULTS
- Hemoglobin: 13.0 g/dL
- Fasting Blood Sugar: 88 mg/dL
- ALT: 28 U/L
`,
  "David Miller (Critical Sugar Alert)": `# CITYLAB DIAGNOSTICS - CLINICAL REPORT
## SECTION I: PATIENT DEMOGRAPHICS
* **Patient Full Name**: David Miller
* **Recorded Age**: 52
* **Biological Sex**: Male
* **Medical Record Number (MRN)**: CLD-CUSTOM-308
* **Date of Issuance**: 2026-11-14

## SECTION III: ANALYTICAL RESULTS
- Fasting Blood Sugar: 340 mg/dL
- Cholesterol: 245 mg/dL
`,
  "Emma Watson (Liver Enzymes High)": `# CITYLAB DIAGNOSTICS - CLINICAL REPORT
## SECTION I: PATIENT DEMOGRAPHICS
* **Patient Full Name**: Emma Watson
* **Recorded Age**: 29
* **Biological Sex**: Female
* **Medical Record Number (MRN)**: CLD-CUSTOM-554
* **Date of Issuance**: 2026-11-14

## SECTION III: ANALYTICAL RESULTS
- SGPT: 75 U/L
- SGOT: 58 U/L
`,
};

export default function Home() {
  // Theme state: dark mode toggle
  const [isDark, setIsDark] = useState<boolean>(true);

  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>("P001");
  const [analysis, setAnalysis] = useState<PatientAnalysis | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"results" | "chat" | "sandbox">("results");

  // Missing Demographics Resolution State
  const [overrideAge, setOverrideAge] = useState<string>("");
  const [overrideSex, setOverrideSex] = useState<string>("female");
  const [hasResolvedDemographics, setHasResolvedDemographics] = useState<boolean>(false);

  // Chat State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState<string>("");
  const [chatLoading, setChatLoading] = useState<boolean>(false);
  const [selectedLang, setSelectedLang] = useState<"english" | "roman_urdu" | "urdu">("english");
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);

  // Expanded Trace Row
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // Sandbox Custom Report State
  const [selectedPreset, setSelectedPreset] = useState<string>("Sarah Connor (Custom Normal CBC)");
  const [customReportText, setCustomReportText] = useState<string>(PRESET_REPORTS["Sarah Connor (Custom Normal CBC)"]);
  const [customReportAnalysis, setCustomReportAnalysis] = useState<PatientAnalysis | null>(null);
  const [customLoading, setCustomLoading] = useState<boolean>(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Persist Theme preference - defaults to luxury dark clinical obsidian mode
  useEffect(() => {
    const savedTheme = localStorage.getItem("citylab_theme");
    if (savedTheme) {
      setIsDark(savedTheme === "dark");
    } else {
      setIsDark(true);
      localStorage.setItem("citylab_theme", "dark");
    }
  }, []);

  const toggleTheme = () => {
    const nextTheme = !isDark;
    setIsDark(nextTheme);
    localStorage.setItem("citylab_theme", nextTheme ? "dark" : "light");
  };

  // Fetch Patient List on Load
  useEffect(() => {
    fetch(`${API_BASE}/patients`)
      .then((res) => res.json())
      .then((data) => {
        if (data.patients && data.patients.length > 0) {
          setPatients(data.patients);
          setSelectedId(data.patients[0].patient_id);
        }
      })
      .catch((err) => {
        console.error("Failed to load patients from backend:", err);
      });
  }, []);

  // Fetch Analysis
  const fetchAnalysis = (age?: number | null, sex?: string | null) => {
    if (!selectedId) return;
    setLoadingAnalysis(true);

    const payload: any = { patient_id: selectedId };
    if (age !== undefined && age !== null) payload.override_age = age;
    if (sex !== undefined && sex !== null) payload.override_sex = sex;

    fetch(`${API_BASE}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then((res) => {
        if (!res.ok) throw new Error("Analysis failed");
        return res.json();
      })
      .then((data: PatientAnalysis) => {
        setAnalysis(data);
      })
      .catch((err) => {
        console.error(err);
      })
      .finally(() => {
        setLoadingAnalysis(false);
      });
  };

  useEffect(() => {
    setHasResolvedDemographics(false);
    setOverrideAge("");
    setOverrideSex("female");
    setMessages([
      {
        role: "assistant",
        content: `👋 **Welcome to CityLab Diagnostics.**\n\nI have loaded the clinical laboratory records for patient **${selectedId}**.\n\n💬 **How to interact & ask questions:**\n• Type any question into the search bar at the bottom and click **Send 🚀**\n• Or click any of the **Quick Ask** chips below for instant clinical explanations\n• Switch between **English**, **Roman Urdu**, or **اردو** anytime using the language buttons at the top right!\n\n*(آپ نیچے دیے گئے باکس میں لیب رپورٹ سے متعلق کوئی بھی سوال اردو یا انگلش میں پوچھ سکتے ہیں)*`,
      },
    ]);
    fetchAnalysis();
  }, [selectedId]);

  // Scroll Chat to bottom & focus input
  useEffect(() => {
    if (activeTab === "chat") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      setTimeout(() => {
        chatInputRef.current?.focus();
      }, 100);
    }
  }, [messages, activeTab]);

  const handleResolveDemographics = (e: React.FormEvent) => {
    e.preventDefault();
    const ageNum = parseInt(overrideAge, 10);
    if (isNaN(ageNum) || ageNum <= 0) {
      alert("Please enter a valid age in years.");
      return;
    }
    setHasResolvedDemographics(true);
    fetchAnalysis(ageNum, overrideSex);
  };

  const handleResetDemographics = () => {
    setHasResolvedDemographics(false);
    setOverrideAge("");
    fetchAnalysis();
  };

  const handleSendMessage = async (customText?: string) => {
    const textToSend = customText || chatInput;
    if (!textToSend.trim() || chatLoading) return;

    const newHistory: ChatMessage[] = [...messages, { role: "user", content: textToSend }];
    setMessages(newHistory);
    if (!customText) setChatInput("");
    setChatLoading(true);

    try {
      const payload: any = {
        patient_id: selectedId,
        message: textToSend,
        history: newHistory.filter((m) => m.role !== "system"),
        language: selectedLang,
      };
      if (hasResolvedDemographics && overrideAge) {
        payload.override_age = parseInt(overrideAge, 10);
        payload.override_sex = overrideSex;
      }

      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error("Chat request failed");
      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.reply,
          urgent_warnings: data.urgent_warnings,
          refused: data.refused,
        },
      ]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, I encountered an error communicating with the AI service. Please ensure the backend is running.",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  // Text-To-Speech function
  const handleSpeakText = (text: string, index: number) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      alert("Speech synthesis is not supported in this browser.");
      return;
    }

    if (speakingIndex === index) {
      window.speechSynthesis.cancel();
      setSpeakingIndex(null);
      return;
    }

    window.speechSynthesis.cancel();
    const cleanText = text.replace(/[*#_`]/g, "");
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 0.95;
    utterance.pitch = 1.0;
    utterance.onend = () => setSpeakingIndex(null);
    utterance.onerror = () => setSpeakingIndex(null);

    setSpeakingIndex(index);
    window.speechSynthesis.speak(utterance);
  };

  // Handle Drag & Drop / File Picker Upload in Sandbox
  const handleFileUpload = (file: File) => {
    if (!file) return;
    setUploadedFileName(`${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (content) {
        setCustomReportText(content);
        // Automatically analyze the uploaded file
        setCustomLoading(true);
        fetch(`${API_BASE}/analyze-custom`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: content }),
        })
          .then((res) => {
            if (!res.ok) throw new Error("Custom analysis failed");
            return res.json();
          })
          .then((data) => {
            setCustomReportAnalysis(data);
          })
          .catch((err) => {
            console.error(err);
          })
          .finally(() => {
            setCustomLoading(false);
          });
      }
    };
    reader.readAsText(file);
  };

  // Analyze Custom Report in Sandbox
  const handleAnalyzeCustom = async () => {
    if (!customReportText.trim() || customLoading) return;
    setCustomLoading(true);
    try {
      const res = await fetch(`${API_BASE}/analyze-custom`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: customReportText }),
      });
      if (!res.ok) throw new Error("Custom analysis failed");
      const data = await res.json();
      setCustomReportAnalysis(data);
    } catch (err: any) {
      alert("Error parsing report: " + err.message);
    } finally {
      setCustomLoading(false);
    }
  };

  const getStatusBadge = (status: TestResult["status"]) => {
    if (isDark) {
      switch (status) {
        case "normal":
          return (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-950/70 text-emerald-300 border border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.2)]">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              Within Range
            </span>
          );
        case "high":
          return (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-950/70 text-rose-300 border border-rose-500/40 shadow-[0_0_12px_rgba(244,63,94,0.2)]">
              <span className="w-2 h-2 rounded-full bg-rose-400"></span>
              High (Elevated)
            </span>
          );
        case "low":
          return (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-950/70 text-amber-300 border border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.2)]">
              <span className="w-2 h-2 rounded-full bg-amber-400"></span>
              Low (Deficient)
            </span>
          );
        case "urgent":
          return (
            <span className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-black bg-gradient-to-r from-red-600 via-rose-600 to-red-600 text-white border border-red-400 shadow-[0_0_22px_rgba(239,68,68,0.5)] animate-pulse">
              <span className="w-2 h-2 rounded-full bg-white animate-ping"></span>
              🚨 Critical Urgent
            </span>
          );
        case "needs_clarification":
          return (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-sky-950/70 text-sky-300 border border-sky-500/40 shadow-[0_0_12px_rgba(14,165,233,0.2)]">
              <span className="w-2 h-2 rounded-full bg-sky-400"></span>
              Requires Demographics
            </span>
          );
        case "cannot_classify":
        default:
          return (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-800 text-slate-300 border border-slate-700">
              <span className="w-2 h-2 rounded-full bg-slate-500"></span>
              Unclassified
            </span>
          );
      }
    } else {
      switch (status) {
        case "normal":
          return (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-xs shadow-emerald-400"></span>
              Within Range
            </span>
          );
        case "high":
          return (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-800 border border-rose-300 shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-rose-500 shadow-xs shadow-rose-400"></span>
              High (Elevated)
            </span>
          );
        case "low":
          return (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-300 shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-amber-500 shadow-xs shadow-amber-400"></span>
              Low (Deficient)
            </span>
          );
        case "urgent":
          return (
            <span className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-black bg-gradient-to-r from-red-600 to-rose-600 text-white shadow-md shadow-red-500/30 animate-pulse">
              <span className="w-2 h-2 rounded-full bg-white animate-ping"></span>
              🚨 Critical Urgent
            </span>
          );
        case "needs_clarification":
          return (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-sky-50 text-sky-800 border border-sky-300 shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-sky-500"></span>
              Requires Demographics
            </span>
          );
        case "cannot_classify":
        default:
          return (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-300 shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-slate-400"></span>
              Unclassified
            </span>
          );
      }
    }
  };

  // Visual Reference Range Spectrum Bar (Gradient Clinical Gauge)
  const renderRangeGauge = (test: TestResult) => {
    if (!test.range_used || test.range_used.low === null || test.range_used.high === null) return null;
    const low = Number(test.range_used.low);
    const high = Number(test.range_used.high);
    const val = Number(test.converted_value);
    if (isNaN(low) || isNaN(high) || isNaN(val)) return null;

    const span = high - low;
    const margin = span * 0.35;
    const minBound = low - margin;
    const maxBound = high + margin;
    let pct = ((val - minBound) / (maxBound - minBound)) * 100;
    pct = Math.max(4, Math.min(96, pct));

    const normalLeftPct = ((low - minBound) / (maxBound - minBound)) * 100;
    const normalWidthPct = ((high - low) / (maxBound - minBound)) * 100;

    return (
      <div className="w-48 mt-2">
        <div className={`relative h-2.5 rounded-full overflow-visible shadow-inner ${isDark ? "bg-slate-800 border border-slate-700" : "bg-gradient-to-r from-amber-100 via-slate-200 to-rose-100"}`}>
          {/* Green Normal Interval Zone */}
          <div
            className={`absolute top-0 bottom-0 rounded-sm ${isDark ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]" : "bg-gradient-to-r from-emerald-400 to-teal-400 shadow-xs"}`}
            style={{ left: `${normalLeftPct}%`, width: `${normalWidthPct}%` }}
          />
          {/* Glowing Patient Value Marker Pin */}
          <div
            className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 transition-all z-10 ${
              test.status === "normal"
                ? "bg-emerald-500 border-white ring-2 ring-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.6)]"
                : test.status === "urgent"
                ? "bg-red-500 border-white ring-4 ring-red-400 scale-125 animate-ping-short shadow-[0_0_15px_rgba(239,68,68,0.8)]"
                : test.status === "high"
                ? "bg-rose-500 border-white ring-2 ring-rose-400 shadow-[0_0_10px_rgba(244,63,94,0.6)]"
                : "bg-amber-500 border-white ring-2 ring-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.6)]"
            }`}
            style={{ left: `calc(${pct}% - 8px)` }}
          />
        </div>
        <div className="flex justify-between items-center text-[10px] font-bold mt-1">
          <span className={isDark ? "text-amber-400/80" : "text-amber-700"}>{low}</span>
          <span className={`text-[9px] uppercase tracking-wider font-black px-1.5 py-0.2 rounded border ${isDark ? "bg-emerald-950/80 text-emerald-300 border-emerald-800" : "bg-emerald-50 text-emerald-800 border-emerald-200"}`}>
            Normal Zone
          </span>
          <span className={isDark ? "text-rose-400/80" : "text-rose-700"}>{high}</span>
        </div>
      </div>
    );
  };

  const selectedPatientObj = patients.find((p) => p.patient_id === selectedId);

  return (
    <div className={`min-h-screen transition-colors duration-300 flex flex-col font-sans ${isDark ? "bg-[#070A12] text-slate-100" : "bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-50/70 via-slate-50 to-indigo-50/40 text-slate-900"}`}>
      {/* Premium Top Navigation Bar */}
      <header className={`border-b sticky top-0 z-30 shadow-xl print:hidden transition-colors ${isDark ? "bg-[#0B0F19]/90 backdrop-blur-xl border-slate-800/80" : "bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white border-indigo-900/50"}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          {/* Logo & Accreditation Brand */}
          <div className="flex items-center space-x-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-400 via-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-cyan-500/30 ring-2 ring-cyan-400/40">
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.3} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-black tracking-tight leading-none bg-gradient-to-r from-white via-cyan-100 to-blue-200 bg-clip-text text-transparent">
                  CityLab Diagnostics
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-cyan-400/20 text-cyan-300 border border-cyan-400/40 tracking-wider uppercase shadow-[0_0_10px_rgba(34,211,238,0.2)]">
                  Clinical AI 2.0
                </span>
              </div>
              <p className="text-xs text-indigo-200/80 mt-1 flex items-center gap-2">
                <span>Autonomous Medical Report Explainer</span>
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                <span className="text-cyan-300 font-bold">CLIA & HIPAA Certified</span>
              </p>
            </div>
          </div>

          {/* Action & Switcher Bar */}
          <div className="flex items-center space-x-3.5">
            {/* Dark / Light Mode Switcher */}
            <button
              onClick={toggleTheme}
              title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
              className={`p-2 rounded-xl border transition-all cursor-pointer flex items-center gap-1.5 text-xs font-bold ${
                isDark
                  ? "bg-slate-800/80 border-slate-700 text-amber-300 hover:bg-slate-700"
                  : "bg-white/10 border-white/20 text-yellow-300 hover:bg-white/20"
              }`}
            >
              {isDark ? (
                <>
                  <svg className="w-4 h-4 text-amber-300" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
                  </svg>
                  <span>Light</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 text-cyan-200" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
                  </svg>
                  <span>Dark</span>
                </>
              )}
            </button>

            {/* Patient Selector */}
            <div className={`flex items-center p-1.5 rounded-2xl border backdrop-blur-md ${isDark ? "bg-slate-900/90 border-slate-700/80" : "bg-white/10 border-white/20"}`}>
              <div className="flex items-center gap-1.5 px-2 text-cyan-300">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span className="text-xs font-bold tracking-wide">Patient:</span>
              </div>
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className={`text-xs font-bold rounded-xl px-3 py-1.5 border focus:ring-2 focus:ring-cyan-400 focus:outline-none cursor-pointer transition-colors ${
                  isDark
                    ? "bg-[#070A12] text-white border-slate-700"
                    : "bg-slate-900 text-white border-indigo-500/40"
                }`}
              >
                {patients.map((p) => (
                  <option key={p.patient_id} value={p.patient_id} className="bg-slate-900 text-white">
                    {p.patient_id} — {p.name} ({p.age !== null ? `${p.age}y` : "Age ?"}, {p.sex || "Sex ?"})
                  </option>
                ))}
              </select>
            </div>

            {/* Print Handout Button */}
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/25 border border-cyan-300/30 transition-all cursor-pointer transform hover:-translate-y-0.5"
            >
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              <span>Export Handout</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full flex flex-col gap-5">
        {/* Urgent Critical Warning Banner */}
        {analysis?.urgent_warnings && analysis.urgent_warnings.length > 0 && (
          <div className="bg-gradient-to-r from-red-600 via-rose-600 to-red-700 rounded-3xl p-5 text-white shadow-2xl shadow-red-500/30 flex items-start gap-4 ring-4 ring-red-200/50 border border-red-400/40 animate-pulse">
            <div className="p-3 bg-white/20 rounded-2xl shrink-0 shadow-inner">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2.5">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-white text-red-700 uppercase tracking-widest shadow-xs">
                  Critical Emergency
                </span>
                <h2 className="text-base font-black tracking-wide text-white">
                  URGENT MEDICAL ATTENTION REQUIRED
                </h2>
              </div>
              <div className="mt-2 text-xs font-semibold text-white space-y-1">
                {analysis.urgent_warnings.map((w, i) => (
                  <p key={i} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-white"></span>
                    <span><strong>{w.test}</strong>: {w.message}</span>
                  </p>
                ))}
              </div>
              <p className="mt-2 text-xs text-red-100 font-medium">
                CLIA Safety Directive: Values have crossed dangerous physiological limits. Please seek medical consultation from a licensed physician immediately.
              </p>
            </div>
          </div>
        )}

        {/* Needs Clarification Banner (Safety Rule 3) */}
        {analysis?.needs_clarification && (
          <div className={`border-2 rounded-3xl p-5 shadow-lg ring-4 transition-colors ${
            isDark
              ? "bg-amber-950/40 border-amber-500/60 ring-amber-900/30 text-amber-200"
              : "bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 border-amber-300 ring-amber-100 text-amber-950"
          }`}>
            <div className="flex items-start gap-4">
              <div className="p-3 bg-gradient-to-tr from-amber-500 to-orange-500 text-white rounded-2xl shrink-0 shadow-md shadow-amber-500/30">
                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-400/20 text-amber-300 border border-amber-400/40 uppercase tracking-wider">
                    Safety Rule 3 Active
                  </span>
                  <h2 className="text-base font-black">
                    Demographic Verification Protocol
                  </h2>
                </div>
                <p className="mt-1 text-xs leading-relaxed font-medium">
                  {analysis.clarification_question || "Normal reference intervals vary significantly by biological sex and age. The safety guidelines mandate asking rather than guessing contextually."}
                </p>

                {/* Interactive Resolution Form */}
                <form onSubmit={handleResolveDemographics} className={`mt-4 p-3.5 rounded-2xl border shadow-md flex flex-wrap items-center gap-3.5 ${
                  isDark ? "bg-[#0B0F19] border-slate-800" : "bg-white border-amber-200"
                }`}>
                  <span className="text-xs font-bold">Provide Verified Demographics:</span>
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs font-semibold opacity-70">Age (years):</label>
                    <input
                      type="number"
                      placeholder="e.g. 35"
                      value={overrideAge}
                      onChange={(e) => setOverrideAge(e.target.value)}
                      className={`w-20 px-3 py-1.5 text-xs font-bold border rounded-xl focus:ring-2 focus:ring-blue-600 focus:outline-none ${
                        isDark ? "bg-[#070A12] border-slate-700 text-white" : "bg-white border-slate-300 text-slate-900"
                      }`}
                      required
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs font-semibold opacity-70">Biological Sex:</label>
                    <select
                      value={overrideSex}
                      onChange={(e) => setOverrideSex(e.target.value)}
                      className={`px-3 py-1.5 text-xs font-bold border rounded-xl focus:ring-2 focus:ring-blue-600 focus:outline-none ${
                        isDark ? "bg-[#070A12] border-slate-700 text-white" : "bg-white border-slate-300 text-slate-900"
                      }`}
                    >
                      <option value="female">Female</option>
                      <option value="male">Male</option>
                    </select>
                  </div>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-xs font-bold rounded-xl shadow-md shadow-amber-600/25 transition-all cursor-pointer transform hover:-translate-y-0.5"
                  >
                    Apply Demographics & Classify Live →
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Resolved Demographic Alert */}
        {hasResolvedDemographics && (
          <div className={`border-2 rounded-2xl p-4 flex items-center justify-between shadow-md transition-colors ${
            isDark ? "bg-emerald-950/40 border-emerald-500/50 text-emerald-200" : "bg-emerald-50 border-emerald-300 text-emerald-950"
          }`}>
            <div className="flex items-center gap-3 text-xs font-medium">
              <span className="w-3 h-3 rounded-full bg-emerald-500 ring-4 ring-emerald-400/30"></span>
              <span>
                <strong>Demographics Resolved Live:</strong> Evaluated with Age: <strong>{overrideAge} yrs</strong> | Sex: <strong className="capitalize">{overrideSex}</strong> against verified reference sheets.
              </span>
            </div>
            <button
              onClick={handleResetDemographics}
              className={`text-xs underline font-bold cursor-pointer ${isDark ? "text-emerald-300 hover:text-white" : "text-emerald-800 hover:text-emerald-950"}`}
            >
              Reset to Original Record
            </button>
          </div>
        )}

        {/* Floating Tab Navigation Pill Bar */}
        <div className="flex items-center justify-between border-b border-slate-200/40 print:hidden pb-1">
          <div className={`flex p-1.5 rounded-2xl shadow-inner gap-1.5 ${isDark ? "bg-slate-900/90 border border-slate-800" : "bg-slate-200/80"}`}>
            <button
              onClick={() => setActiveTab("results")}
              className={`px-4 py-2 text-xs font-bold rounded-xl flex items-center gap-2 transition-all cursor-pointer ${
                activeTab === "results"
                  ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/30"
                  : isDark ? "text-slate-400 hover:text-white hover:bg-slate-800" : "text-slate-600 hover:text-slate-900 hover:bg-white/60"
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Analytical Classification & Gauges
            </button>
            <button
              onClick={() => setActiveTab("chat")}
              className={`px-4 py-2 text-xs font-bold rounded-xl flex items-center gap-2 transition-all cursor-pointer ${
                activeTab === "chat"
                  ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/30"
                  : isDark ? "text-slate-400 hover:text-white hover:bg-slate-800" : "text-slate-600 hover:text-slate-900 hover:bg-white/60"
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              Clinical Explainer Chat
              <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-cyan-400 text-slate-950 font-black">AI</span>
            </button>
            <button
              onClick={() => setActiveTab("sandbox")}
              className={`px-4 py-2 text-xs font-bold rounded-xl flex items-center gap-2 transition-all cursor-pointer ${
                activeTab === "sandbox"
                  ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/30"
                  : isDark ? "text-slate-400 hover:text-white hover:bg-slate-800" : "text-slate-600 hover:text-slate-900 hover:bg-white/60"
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
              Testing Sandbox
              <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-emerald-500 text-white font-black">Bonus</span>
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs font-semibold opacity-70 hidden sm:flex">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>Deterministic Engine Active</span>
          </div>
        </div>

        {/* Tab 1: Analytical Results View */}
        {activeTab === "results" && (
          <div className="space-y-5">
            {/* Executive Patient Demographic & Metrics Summary Card */}
            <div className={`rounded-3xl border p-5 shadow-2xl backdrop-blur-xl transition-all ${
              isDark
                ? "bg-[#0B0F19]/90 border-slate-800/80 shadow-[0_10px_40px_rgba(0,0,0,0.5)]"
                : "bg-white/95 border-slate-200/90 shadow-xl shadow-slate-200/50"
            } flex flex-wrap items-center justify-between gap-4`}>
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-cyan-500 flex items-center justify-center font-black text-white text-xl shadow-lg shadow-blue-500/30 ring-4 ring-blue-500/20">
                  {selectedPatientObj?.name?.charAt(0) || "P"}
                </div>
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-xl font-black tracking-tight">
                      {analysis?.patient_name || selectedPatientObj?.name}
                    </h2>
                    <span className={`text-xs px-2.5 py-0.5 rounded-lg font-mono font-bold border ${
                      isDark ? "bg-slate-800 text-cyan-300 border-slate-700" : "bg-blue-50 text-blue-700 border-blue-200"
                    }`}>
                      ID: {selectedId}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs opacity-75 mt-1 font-medium">
                    <span>Age: <strong className={isDark ? "text-white" : "text-slate-900"}>{analysis?.age !== null ? `${analysis?.age} years` : "Unspecified"}</strong></span>
                    <span>•</span>
                    <span>Biological Sex: <strong className={`capitalize ${isDark ? "text-white" : "text-slate-900"}`}>{analysis?.biological_sex || "Unspecified"}</strong></span>
                    <span>•</span>
                    <span>Record: <code className={`px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold ${isDark ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}`}>{analysis?.source_file}</code></span>
                  </div>
                </div>
              </div>

              {/* 4-Card Executive Metric Strip */}
              <div className="flex items-center gap-2.5">
                <div className={`text-center px-4 py-2.5 rounded-2xl border shadow-sm ${
                  isDark ? "bg-[#070A12] border-slate-800 text-cyan-400" : "bg-gradient-to-b from-slate-50 to-slate-100/60 border-slate-200 text-slate-900"
                }`}>
                  <div className="text-[10px] uppercase font-bold opacity-60 tracking-wider">Total Tests</div>
                  <div className="text-lg font-black">{analysis?.tests?.length || 0}</div>
                </div>
                <div className={`text-center px-4 py-2.5 rounded-2xl border shadow-sm ${
                  isDark ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-400" : "bg-gradient-to-b from-emerald-50 to-teal-50/50 border-emerald-200 text-emerald-700"
                }`}>
                  <div className="text-[10px] uppercase font-bold opacity-75 tracking-wider">In Range</div>
                  <div className="text-lg font-black">
                    {analysis?.tests?.filter((t) => t.status === "normal").length || 0}
                  </div>
                </div>
                <div className={`text-center px-4 py-2.5 rounded-2xl border shadow-sm ${
                  isDark ? "bg-rose-950/40 border-rose-800/60 text-rose-400" : "bg-gradient-to-b from-rose-50 to-pink-50/50 border-rose-200 text-rose-700"
                }`}>
                  <div className="text-[10px] uppercase font-bold opacity-75 tracking-wider">Out of Range</div>
                  <div className="text-lg font-black">
                    {analysis?.tests?.filter((t) => ["high", "low", "urgent"].includes(t.status)).length || 0}
                  </div>
                </div>
              </div>
            </div>

            {loadingAnalysis ? (
              <div className={`py-24 text-center rounded-3xl border shadow-xl ${isDark ? "bg-[#0B0F19]/80 border-slate-800" : "bg-white/80 border-slate-200"}`}>
                <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-blue-500 border-r-transparent"></div>
                <p className="mt-3 text-xs font-bold opacity-70">Executing deterministic classification pipeline...</p>
              </div>
            ) : (
              <>
                {/* Clinical Analytical Results Table */}
                <div className={`rounded-3xl border overflow-hidden shadow-2xl backdrop-blur-xl ${
                  isDark ? "bg-[#0B0F19]/90 border-slate-800/80 shadow-[0_15px_50px_rgba(0,0,0,0.6)]" : "bg-white/95 border-slate-200/90 shadow-xl shadow-slate-200/40"
                }`}>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-800/50 text-sm">
                      <thead className={isDark ? "bg-slate-900/90" : "bg-gradient-to-r from-slate-50 via-indigo-50/30 to-slate-50"}>
                        <tr>
                          <th className="px-6 py-4 text-left text-xs font-black uppercase tracking-wider opacity-75">
                            Analyte / Test
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-black uppercase tracking-wider opacity-75">
                            Reported Value
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-black uppercase tracking-wider opacity-75">
                            Reference Interval & Spectrum
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-black uppercase tracking-wider opacity-75">
                            Diagnostic Status
                          </th>
                          <th className="px-6 py-4 text-right text-xs font-black uppercase tracking-wider opacity-75">
                            Evidence & Trace
                          </th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${isDark ? "divide-slate-800/50 bg-[#070A12]/40" : "divide-slate-100 bg-white"}`}>
                        {analysis?.tests?.map((test, idx) => (
                          <React.Fragment key={idx}>
                            <tr className={`transition-colors ${
                              test.urgent_flag
                                ? isDark ? "bg-red-950/40" : "bg-red-50/50"
                                : isDark ? "hover:bg-slate-800/40" : "hover:bg-blue-50/40"
                            }`}>
                              <td className="px-6 py-4">
                                <div className="font-extrabold text-sm">{test.original_name}</div>
                                {test.canonical_name && test.canonical_name !== test.original_name && (
                                  <div className={`text-[11px] font-semibold mt-0.5 ${isDark ? "text-cyan-400" : "text-indigo-600"}`}>
                                    Alias mapped: <span className="font-bold underline">{test.canonical_name}</span>
                                  </div>
                                )}
                              </td>

                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="font-black text-base">
                                  {String(test.value)} <span className="font-semibold text-xs opacity-60">{test.original_unit}</span>
                                </div>
                                {test.conversion_shown && (
                                  <div className={`text-[11px] font-bold px-2 py-0.5 rounded-md mt-1 inline-block border ${
                                    isDark ? "bg-indigo-950/60 text-indigo-300 border-indigo-700/60" : "bg-indigo-50 text-indigo-700 border-indigo-200"
                                  }`}>
                                    Converted: {String(test.converted_value)} {test.converted_unit} (Factor: {String(test.conversion_shown.factor)})
                                  </div>
                                )}
                              </td>

                              <td className="px-6 py-4">
                                {test.range_used?.low !== undefined && test.range_used?.high !== undefined ? (
                                  <div>
                                    <span className="font-black text-xs">
                                      {String(test.range_used.low)} – {String(test.range_used.high)} {test.converted_unit}
                                    </span>
                                    {renderRangeGauge(test)}
                                  </div>
                                ) : (
                                  <span className="text-xs opacity-50 italic">No numeric range match in files</span>
                                )}
                              </td>

                              <td className="px-6 py-4 whitespace-nowrap">
                                {getStatusBadge(test.status)}
                              </td>

                              <td className="px-6 py-4 text-right whitespace-nowrap">
                                <button
                                  onClick={() => setExpandedRow(expandedRow === idx ? null : idx)}
                                  className={`text-xs font-black inline-flex items-center gap-1 cursor-pointer px-3 py-1.5 rounded-xl border transition-colors shadow-2xs ${
                                    isDark
                                      ? "bg-slate-800 text-cyan-300 border-slate-700 hover:bg-slate-700"
                                      : "bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100"
                                  }`}
                                >
                                  {expandedRow === idx ? "Hide Evidence" : "View Evidence"}
                                  <svg
                                    className={`w-3.5 h-3.5 transition-transform ${expandedRow === idx ? "rotate-180" : ""}`}
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </button>
                              </td>
                            </tr>

                            {/* Expanded Clinical Audit Evidence Row */}
                            {expandedRow === idx && (
                              <tr className={`border-t ${isDark ? "bg-slate-900/60 border-slate-800" : "bg-slate-50/90 border-slate-200"}`}>
                                <td colSpan={5} className="px-6 py-4">
                                  <div className={`p-4 rounded-2xl border shadow-sm space-y-2.5 text-xs ${
                                    isDark ? "bg-[#0B0F19] border-slate-800 text-slate-200" : "bg-white border-slate-200 text-slate-700"
                                  }`}>
                                    <div className="flex items-start gap-2">
                                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-400/30 uppercase tracking-wide">
                                        Clinical Interpretation
                                      </span>
                                      <span className="leading-relaxed font-semibold">
                                        {test.explanation || test.reason}
                                      </span>
                                    </div>
                                    {test.trace && test.trace.length > 0 && (
                                      <div>
                                        <strong className="font-bold block mb-1">Audit Trail & Regulatory Citations:</strong>
                                        <ul className={`list-disc list-inside font-mono text-[11px] space-y-1 p-3 rounded-xl border ${
                                          isDark ? "bg-[#070A12] border-slate-800 text-slate-400" : "bg-slate-50 border-slate-200 text-slate-600"
                                        }`}>
                                          {test.trace.map((item, tIdx) => (
                                            <li key={tIdx}>{item}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Doctor Follow-Up Questions Card */}
                {analysis?.doctor_questions && analysis.doctor_questions.length > 0 && (
                  <div className={`rounded-3xl border p-6 shadow-xl backdrop-blur-xl ${
                    isDark ? "bg-[#0B0F19]/90 border-slate-800/80 shadow-[0_15px_40px_rgba(0,0,0,0.5)]" : "bg-white/95 border-slate-200/90 shadow-xl shadow-slate-200/40"
                  }`}>
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white flex items-center justify-center font-bold shadow-md shadow-indigo-500/30">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="text-base font-black">
                          Recommended Follow-Up Questions for Your Physician
                        </h3>
                        <p className="text-xs opacity-60 font-medium">
                          Clinically tailored questions based strictly on results outside normal limits:
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                      {analysis.doctor_questions.map((q, qIdx) => (
                        <div
                          key={qIdx}
                          className={`rounded-2xl p-4 border text-xs flex flex-col justify-between transition-all group ${
                            isDark
                              ? "bg-[#070A12] border-slate-800 text-slate-200 hover:border-blue-500 hover:shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                              : "bg-gradient-to-b from-slate-50 to-white border-slate-200 text-slate-700 hover:border-blue-400 hover:shadow-md"
                          }`}
                        >
                          <p className="font-bold leading-snug">"{q}"</p>
                          <button
                            onClick={() => {
                              setActiveTab("chat");
                              handleSendMessage(q);
                            }}
                            className="mt-3.5 text-blue-500 hover:text-blue-400 font-extrabold self-start inline-flex items-center gap-1.5 cursor-pointer text-xs group-hover:translate-x-0.5 transition-transform"
                          >
                            <span>Ask Clinical Explainer</span>
                            <span>→</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Tab 2: AI Chat Explainer View */}
        {activeTab === "chat" && (
          <div className={`rounded-3xl border shadow-2xl flex flex-col h-[calc(100vh-270px)] min-h-[460px] max-h-[640px] overflow-hidden backdrop-blur-xl ${
            isDark ? "bg-[#0B0F19]/95 border-slate-800/80 shadow-[0_20px_50px_rgba(0,0,0,0.7)] ring-1 ring-white/5" : "bg-white/95 border-slate-200/90 shadow-xl shadow-slate-200/50"
          }`}>
            {/* Chat Header with Language Selector & Status */}
            <div className={`px-6 py-3.5 border-b flex flex-wrap gap-2 items-center justify-between shrink-0 ${
              isDark ? "bg-slate-900/90 border-slate-800" : "bg-gradient-to-r from-slate-50 via-indigo-50/40 to-slate-50 border-slate-200"
            }`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-cyan-400 via-blue-500 to-indigo-600 text-white flex items-center justify-center font-bold text-sm shadow-md shadow-blue-500/30 ring-2 ring-cyan-400/30">
                  AI
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-black leading-tight">CityLab Clinical Explainer</h3>
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      Groq LLM Active
                    </span>
                  </div>
                  <p className="text-[11px] opacity-60 mt-0.5 font-medium">
                    Locked to: <strong className={isDark ? "text-cyan-300" : "text-slate-900"}>{selectedId} ({selectedPatientObj?.name})</strong> • HIPAA Patient Context Lock
                  </p>
                </div>
              </div>

              {/* Language Selector Button Group */}
              <div className={`flex items-center p-1 rounded-2xl border shadow-sm ${
                isDark ? "bg-[#070A12] border-slate-800" : "bg-white border-slate-200"
              }`}>
                <span className="text-[11px] font-bold opacity-60 px-2.5">Language:</span>
                <button
                  onClick={() => setSelectedLang("english")}
                  className={`px-3 py-1 rounded-xl text-xs font-bold cursor-pointer transition-all ${
                    selectedLang === "english" ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-xs" : "opacity-70 hover:opacity-100"
                  }`}
                >
                  English
                </button>
                <button
                  onClick={() => setSelectedLang("roman_urdu")}
                  className={`px-3 py-1 rounded-xl text-xs font-bold cursor-pointer transition-all ${
                    selectedLang === "roman_urdu" ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-xs" : "opacity-70 hover:opacity-100"
                  }`}
                >
                  Roman Urdu
                </button>
                <button
                  onClick={() => setSelectedLang("urdu")}
                  className={`px-3 py-1 rounded-xl text-xs font-bold cursor-pointer transition-all ${
                    selectedLang === "urdu" ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-xs" : "opacity-70 hover:opacity-100"
                  }`}
                >
                  اردو
                </button>
              </div>
            </div>

            {/* Message Feed Area */}
            <div className={`flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 ${isDark ? "bg-[#070A12]/60" : "bg-slate-50/40"}`}>
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] sm:max-w-[75%] rounded-3xl p-4 text-sm leading-relaxed shadow-md relative ${
                      msg.role === "user"
                        ? "bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 text-white rounded-br-xs font-semibold shadow-blue-600/30"
                        : msg.refused
                        ? isDark ? "bg-amber-950/60 text-amber-200 border border-amber-600/60 rounded-bl-xs" : "bg-amber-50 text-amber-950 border border-amber-300 rounded-bl-xs font-medium"
                        : isDark ? "bg-[#111827] text-slate-100 border border-slate-800 rounded-bl-xs shadow-black/40" : "bg-white text-slate-800 border border-slate-200/90 rounded-bl-xs"
                    }`}
                  >
                    {msg.urgent_warnings && msg.urgent_warnings.length > 0 && (
                      <div className="mb-2 p-2.5 bg-red-900/60 text-red-200 rounded-xl text-xs font-bold flex items-center gap-1.5 border border-red-500/60">
                        <span>🚨 Critical Limit Alert:</span> Please consult your physician today.
                      </div>
                    )}
                    <div className="whitespace-pre-wrap">{msg.content}</div>

                    {/* Audio Readout Tool for AI responses */}
                    {msg.role === "assistant" && (
                      <div className={`mt-3 pt-2.5 border-t flex items-center justify-between ${isDark ? "border-slate-800" : "border-slate-100"}`}>
                        <button
                          onClick={() => handleSpeakText(msg.content, i)}
                          className={`inline-flex items-center gap-1.5 text-xs font-bold cursor-pointer px-3 py-1.5 rounded-xl transition-colors ${
                            isDark
                              ? "bg-slate-800 text-cyan-300 hover:bg-slate-700"
                              : "bg-blue-50 text-blue-600 hover:bg-blue-100"
                          }`}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                          </svg>
                          <span>{speakingIndex === i ? "⏹ Stop Speaking" : "🔊 Listen Audio Summary"}</span>
                        </button>
                        <span className="text-[10px] font-bold opacity-50">Groq High-Speed Inference</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex justify-start">
                  <div className={`rounded-2xl p-4 border rounded-bl-xs shadow-xs flex items-center space-x-2 ${
                    isDark ? "bg-[#111827] border-slate-800" : "bg-white border-slate-200"
                  }`}>
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse delay-75"></span>
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse delay-150"></span>
                    <span className="text-xs font-semibold opacity-70 ml-2">Consulting clinical references & safety protocols...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick Prompt Suggestions */}
            <div className={`px-5 py-2.5 border-t flex items-center gap-2 overflow-x-auto text-xs shrink-0 ${isDark ? "bg-slate-900/90 border-slate-800" : "bg-white border-slate-100"}`}>
              <span className="opacity-60 whitespace-nowrap text-[11px] font-bold flex items-center gap-1 text-cyan-400">
                <span>⚡ Quick Ask:</span>
              </span>
              <button
                onClick={() => handleSendMessage("Can you summarize all my test results in simple layman words?")}
                className={`px-3 py-1.5 rounded-full font-bold whitespace-nowrap cursor-pointer transition-all border ${
                  isDark ? "bg-slate-800/80 border-slate-700 text-slate-200 hover:border-cyan-400 hover:text-cyan-300" : "bg-slate-50 hover:bg-blue-50 border-slate-200 text-slate-700"
                }`}
              >
                📊 Summarize All Results
              </button>
              <button
                onClick={() => handleSendMessage("Are any of my values dangerous or urgent?")}
                className={`px-3 py-1.5 rounded-full font-bold whitespace-nowrap cursor-pointer transition-all border ${
                  isDark ? "bg-slate-800/80 border-slate-700 text-slate-200 hover:border-cyan-400 hover:text-cyan-300" : "bg-slate-50 hover:bg-blue-50 border-slate-200 text-slate-700"
                }`}
              >
                🚨 Check Critical Values
              </button>
              <button
                onClick={() => handleSendMessage("What specific questions should I ask my doctor?")}
                className={`px-3 py-1.5 rounded-full font-bold whitespace-nowrap cursor-pointer transition-all border ${
                  isDark ? "bg-slate-800/80 border-slate-700 text-slate-200 hover:border-cyan-400 hover:text-cyan-300" : "bg-slate-50 hover:bg-blue-50 border-slate-200 text-slate-700"
                }`}
              >
                🩺 Doctor Questions
              </button>
              <button
                onClick={() => handleSendMessage("Mera Fasting Blood Sugar 6.0 mmol/L hai, iska mg/dL mein kya matlab banta hai?")}
                className={`px-3 py-1.5 rounded-full font-bold whitespace-nowrap cursor-pointer transition-all border ${
                  isDark ? "bg-slate-800/80 border-slate-700 text-slate-200 hover:border-cyan-400 hover:text-cyan-300" : "bg-slate-50 hover:bg-blue-50 border-slate-200 text-slate-700"
                }`}
              >
                🔄 Unit Conversion (mmol/L → mg/dL)
              </button>
              <button
                onClick={() => handleSendMessage("Kya aap asaan Roman Urdu mein mujhe ye report samjha sakte hain?")}
                className={`px-3 py-1.5 rounded-full font-bold whitespace-nowrap cursor-pointer transition-all border ${
                  isDark ? "bg-slate-800/80 border-slate-700 text-slate-200 hover:border-cyan-400 hover:text-cyan-300" : "bg-slate-50 hover:bg-blue-50 border-slate-200 text-slate-700"
                }`}
              >
                🇵🇰 Roman Urdu Samjhao
              </button>
            </div>

            {/* Pinned Input Bar with High-Visibility Glow */}
            <div className={`p-4 border-t flex flex-col gap-2 shrink-0 ${isDark ? "bg-[#0B0F19] border-slate-800" : "bg-white border-slate-200"}`}>
              <div className="flex gap-2.5 items-center">
                <div className={`flex-1 flex items-center border-2 rounded-2xl px-4 py-1.5 transition-all shadow-inner ${
                  isDark
                    ? "bg-[#070A12] border-slate-700/80 focus-within:border-cyan-400 focus-within:ring-2 focus-within:ring-cyan-400/30"
                    : "bg-slate-50 border-slate-300 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-400/30"
                }`}>
                  <span className="text-base mr-2 opacity-60">💬</span>
                  <input
                    ref={chatInputRef}
                    type="text"
                    placeholder={
                      selectedLang === "urdu"
                        ? "اپنی لیب رپورٹ کے متعلق کوئی بھی سوال یہاں لکھیں اور Enter دبائیں..."
                        : selectedLang === "roman_urdu"
                        ? "Apni lab report ke bare mein koi bhi sawal yahan likhein aur Send dabayein..."
                        : `Ask any question about ${selectedId}'s lab results (e.g. 'What does my Hemoglobin mean?')...`
                    }
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSendMessage();
                    }}
                    disabled={chatLoading}
                    className={`flex-1 py-2 text-sm focus:outline-none bg-transparent font-semibold ${
                      isDark ? "text-white placeholder-slate-500" : "text-slate-900 placeholder-slate-400"
                    }`}
                  />
                  {chatInput && (
                    <button
                      onClick={() => setChatInput("")}
                      className="text-xs opacity-50 hover:opacity-100 px-2 py-1 cursor-pointer font-bold"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <button
                  onClick={() => handleSendMessage()}
                  disabled={chatLoading || !chatInput.trim()}
                  className="px-6 py-3.5 bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white rounded-2xl text-sm font-black shadow-lg shadow-cyan-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2 cursor-pointer shrink-0 transform hover:-translate-y-0.5 active:translate-y-0"
                >
                  <span>Send</span>
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </button>
              </div>

              <div className="flex justify-between items-center px-1 text-[10px] font-semibold opacity-50">
                <span>Press <strong>Enter ↵</strong> to send immediately</span>
                <span>🔒 Privacy Protected • CLIA & HIPAA Medical Rules Enforced</span>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Custom Report Sandbox */}
        {activeTab === "sandbox" && (
          <div className={`rounded-3xl border p-7 shadow-2xl backdrop-blur-xl space-y-5 ${
            isDark ? "bg-[#0B0F19]/90 border-slate-800/80 shadow-[0_20px_50px_rgba(0,0,0,0.6)]" : "bg-white/95 border-slate-200/90 shadow-xl shadow-slate-200/50"
          }`}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-black flex items-center gap-2.5">
                  <span>🔬 Live Custom Report Ingestion Sandbox</span>
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 px-3 py-0.5 rounded-full font-black">
                    Judges Testing Feature
                  </span>
                </h2>
                <p className="text-xs opacity-60 mt-1 font-medium">
                  Test the deterministic extraction engine on unseen patient markdown reports or select an interactive preset below.
                </p>
              </div>

              {/* Presets Selector */}
              <div className={`flex items-center gap-2 p-1.5 rounded-xl border ${isDark ? "bg-slate-900 border-slate-800" : "bg-slate-100 border-slate-200"}`}>
                <span className="text-xs font-bold opacity-75 px-2">Preset:</span>
                <select
                  value={selectedPreset}
                  onChange={(e) => {
                    setSelectedPreset(e.target.value);
                    setCustomReportText(PRESET_REPORTS[e.target.value]);
                  }}
                  className={`text-xs font-bold rounded-lg px-3 py-1.5 cursor-pointer border ${
                    isDark ? "bg-[#070A12] border-slate-700 text-white" : "bg-white border-slate-200 text-slate-900"
                  }`}
                >
                  {Object.keys(PRESET_REPORTS).map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                {/* Drag & Drop File Dropzone */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                      handleFileUpload(e.dataTransfer.files[0]);
                    }
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className={`mb-3.5 p-4 border-2 border-dashed rounded-2xl cursor-pointer transition-all flex items-center justify-between gap-3 shadow-inner ${
                    isDragging
                      ? "border-cyan-400 bg-cyan-500/15 scale-[1.01]"
                      : isDark
                      ? "border-slate-700/80 bg-slate-900/60 hover:border-cyan-400/60 hover:bg-slate-800/50"
                      : "border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50/60"
                  }`}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        handleFileUpload(e.target.files[0]);
                      }
                    }}
                    accept=".txt,.md,.markdown,.json,.csv"
                    className="hidden"
                  />
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-cyan-500/25">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-xs font-bold flex items-center gap-2">
                        <span>{uploadedFileName ? `📄 ${uploadedFileName}` : "📁 Drag & Drop Report (.md / .txt) here"}</span>
                        {uploadedFileName && (
                          <span className="px-2 py-0.2 rounded-full text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-bold">
                            Active
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] opacity-60 mt-0.5 font-medium">
                        Click to browse local files or drop file to parse instantly
                      </p>
                    </div>
                  </div>
                  <span className={`text-xs font-bold px-3 py-1.5 rounded-xl border shrink-0 transition-colors shadow-2xs ${
                    isDark ? "bg-slate-800 border-slate-700 text-cyan-300 hover:bg-slate-700" : "bg-white border-slate-200 text-blue-600 hover:bg-blue-50"
                  }`}>
                    Browse File
                  </span>
                </div>

                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold opacity-80">Report Markdown Content:</label>
                  <span className="text-[11px] opacity-50 font-medium">Editable in real-time</span>
                </div>
                <textarea
                  rows={10}
                  value={customReportText}
                  onChange={(e) => setCustomReportText(e.target.value)}
                  className={`w-full font-mono text-xs p-4 rounded-2xl border focus:ring-2 focus:ring-cyan-400 focus:outline-none shadow-inner ${
                    isDark ? "bg-[#070A12] border-slate-700 text-slate-100" : "bg-slate-50 border-slate-300 text-slate-900"
                  }`}
                />
                <button
                  onClick={handleAnalyzeCustom}
                  disabled={customLoading}
                  className="mt-3.5 px-6 py-3 bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white rounded-2xl text-xs font-bold shadow-lg shadow-blue-500/30 flex items-center gap-2 cursor-pointer transition-all transform hover:-translate-y-0.5"
                >
                  {customLoading ? "Parsing & Classifying..." : "Parse & Classify Custom Report →"}
                </button>
              </div>

              <div>
                <label className="block text-xs font-bold opacity-80 mb-2">Live Classification Extraction:</label>
                {customReportAnalysis ? (
                  <div className={`border rounded-2xl p-4 space-y-3 max-h-[380px] overflow-y-auto ${
                    isDark ? "bg-[#070A12] border-slate-800" : "bg-slate-50 border-slate-200"
                  }`}>
                    <div className="text-xs font-black border-b border-slate-800 pb-2.5 flex justify-between">
                      <span>Patient: {customReportAnalysis.patient_name}</span>
                      <span>Age: {customReportAnalysis.age} | Sex: {customReportAnalysis.biological_sex}</span>
                    </div>
                    <div className="space-y-2.5">
                      {customReportAnalysis.tests.map((t, idx) => (
                        <div key={idx} className={`p-3.5 rounded-xl border flex items-center justify-between text-xs shadow-2xs ${
                          isDark ? "bg-[#0B0F19] border-slate-800" : "bg-white border-slate-200"
                        }`}>
                          <div>
                            <div className="font-bold">{t.original_name}</div>
                            <div className="text-[11px] opacity-60 font-mono mt-0.5">Value: {String(t.value)} {t.original_unit}</div>
                          </div>
                          <div>{getStatusBadge(t.status)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className={`h-[340px] border-2 border-dashed rounded-2xl flex flex-col items-center justify-center text-xs text-center p-6 space-y-2 ${
                    isDark ? "border-slate-800 text-slate-500" : "border-slate-200 text-slate-400"
                  }`}>
                    <svg className="w-9 h-9 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span className="font-semibold">Click "Parse & Classify Custom Report" to evaluate live on unseen data.</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Clinical Legal Disclaimer Footer */}
        <div className={`rounded-2xl p-4 text-center border shadow-2xs ${
          isDark ? "bg-[#0B0F19]/90 border-slate-800/80 text-slate-400" : "bg-slate-100/90 border-slate-200/80 text-slate-500"
        }`}>
          <p className="text-[11px] leading-relaxed font-medium">
            <strong>Clinical & Legal Disclaimer:</strong> {analysis?.disclaimer || "This tool compares analytical results with the supplied clinical reference files and does not diagnose disease or prescribe therapy. Only a licensed physician can diagnose conditions. Adheres strictly to HIPAA, CLIA 1988, and CityLab Safety Protocols."}
          </p>
        </div>
      </main>
    </div>
  );
}
