
"use client"

import { useState } from "react"
import PdfDownloadButton from "../components/PdfDownloadButton"

type AtsResult = {
  score: number
  match_level: string
  missing_keywords: string[]
  issues: string[]
  suggestions: string[]
} | null

type ContactInfo = {
  fullName: string
  email: string
  phone: string
  linkedin: string
  location: string
}

export default function Page() {
  const [resumeText, setResumeText] = useState("")
  const [jobDescription, setJobDescription] = useState("")
  const [loading, setLoading] = useState(false)
  const [activeAction, setActiveAction] = useState<"ats" | "rewrite" | null>(null)

  const [atsResult, setAtsResult] = useState<AtsResult>(null)
  const [rewrittenResume, setRewrittenResume] = useState("")
  const [contactInfo, setContactInfo] = useState<ContactInfo | null>(null)

  const [wordCount, setWordCount] = useState<number | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isBusy = (name: "ats" | "rewrite") => loading && activeAction === name

  const handleCallApi = async (action: "analyzeATS" | "rewriteForJob") => {
    setError(null)

    if (action === "analyzeATS") {
      setAtsResult(null)
    } else {
      setRewrittenResume("")
      setContactInfo(null)
      setWordCount(null)
      setWarning(null)
    }

    if (!resumeText.trim()) {
      setError("Please paste your resume text first.")
      return
    }

    if (!jobDescription.trim()) {
      setError("Please paste the job description first.")
      return
    }

    setLoading(true)
    setActiveAction(action === "analyzeATS" ? "ats" : "rewrite")

    try {
      const res = await fetch("/api/ats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          payload: {
            resume: resumeText,
            jobDescription,
          },
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data?.error || "Server error")
      }

      if (action === "analyzeATS") {
        setAtsResult({
          score: data.score,
          match_level: data.match_level,
          missing_keywords: data.missing_keywords || [],
          issues: data.issues || [],
          suggestions: data.suggestions || [],
        })
      } else {
        const wc = typeof data.word_count === "number" ? data.word_count : null
        setWordCount(wc ?? null)
        setRewrittenResume(data.rewritten_resume || "")

        if (data.contact_info) {
          setContactInfo({
            fullName: data.contact_info.fullName || "",
            email: data.contact_info.email || "",
            phone: data.contact_info.phone || "",
            linkedin: data.contact_info.linkedin || "",
            location: data.contact_info.location || "",
          })
        }

        if (data.warning) {
          setWarning(data.warning as string)
        } else {
          setWarning(null)
        }
      }
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : "Unexpected error"
      setError(errorMessage)
    } finally {
      setLoading(false)
      setActiveAction(null)
    }
  }

  const scoreColor = (score: number | undefined) => {
    if (score === undefined) return "bg-slate-400"
    if (score >= 85) return "bg-emerald-500"
    if (score >= 70) return "bg-blue-500"
    if (score >= 50) return "bg-amber-500"
    return "bg-rose-500"
  }

  const scoreLabel = (score: number | undefined) => {
    if (score === undefined) return ""
    if (score >= 85) return "Excellent match"
    if (score >= 70) return "Strong match"
    if (score >= 50) return "Okay match"
    return "Weak match"
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900 text-slate-100">
      {/* Header */}
      <header className="border-b border-white/10 bg-slate-950/60 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center text-slate-950 font-extrabold text-xs">
              ATS
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight">
                SmartATS Pro
              </h1>
              <p className="text-xs text-slate-400">
                Resume • ATS Analysis • Job-tailored Rewrite
              </p>
            </div>
          </div>
          <span className="text-[11px] px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
            Powered by Groq · llama-3.3-70b-versatile
          </span>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Top grid: inputs + actions */}
        <section className="grid gap-4 md:grid-cols-2">
          {/* Resume input */}
          <div className="bg-slate-900/60 border border-slate-700/60 rounded-2xl p-4 shadow-lg shadow-black/30 relative overflow-hidden">
            <div className="absolute inset-0 pointer-events-none opacity-10 bg-[radial-gradient(circle_at_top,_#22c55e,_transparent_60%),_radial-gradient(circle_at_bottom,_#06b6d4,_transparent_55%)]" />
            <div className="relative z-10 space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-300">
                  Resume Text
                </label>
                <span className="text-[11px] text-slate-500">
                  الصق سيرتك الذاتية هنا
                </span>
              </div>
              <textarea
                value={resumeText}
                onChange={(e) => setResumeText(e.target.value)}
                className="w-full h-48 rounded-xl bg-slate-950/60 border border-slate-700 px-3 py-2 text-xs md:text-sm text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500/60 focus:border-emerald-500/60 resize-none"
                placeholder="Paste your resume here (name, contact info, experience, skills, education...)"
              />
              <div className="flex justify-between text-[11px] text-slate-500">
                <span>{resumeText.trim().split(/\s+/).filter(Boolean).length || 0} words</span>
                <span>Plain text · No PDF upload (yet)</span>
              </div>
            </div>
          </div>

          {/* Job description + actions */}
          <div className="flex flex-col gap-4">
            <div className="bg-slate-900/60 border border-slate-700/60 rounded-2xl p-4 shadow-lg shadow-black/30">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-300">
                  Job Description
                </label>
                <span className="text-[11px] text-slate-500">
                  الوصف الوظيفي المستهدف
                </span>
              </div>
              <textarea
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                className="w-full h-32 rounded-xl bg-slate-950/60 border border-slate-700 px-3 py-2 text-xs md:text-sm text-slate-100 outline-none focus:ring-2 focus:ring-cyan-500/60 focus:border-cyan-500/60 resize-none"
                placeholder="Paste the job description you want to target..."
              />
              <p className="mt-2 text-[11px] text-slate-500">
                سيتم استخدام الوصف الوظيفي لمطابقة الكلمات المفتاحية وتحسين ملاءمة السيرة.
              </p>
            </div>

            {/* Action buttons */}
            <div className="bg-slate-900/60 border border-slate-700/60 rounded-2xl p-4 flex flex-col gap-3 shadow-lg shadow-black/30">
              <p className="text-[11px] text-slate-400 mb-1">
                اختر ما تريد القيام به:
              </p>
              <div className="flex flex-wrap gap-3">
                {/* ATS Button - محسن */}
                <button
                  onClick={() => handleCallApi("analyzeATS")}
                  disabled={loading}
                  className={`relative px-5 py-2 rounded-xl text-xs md:text-sm font-semibold text-white overflow-hidden
                    ${
                      isBusy("ats")
                        ? "bg-blue-500 cursor-wait"
                        : "bg-blue-600 hover:bg-blue-500"
                    }
                    disabled:opacity-60 disabled:cursor-not-allowed transition-transform duration-150 active:scale-[0.98]`}
                >
                  {isBusy("ats") && (
                    <span className="absolute inset-0 bg-blue-400/20 animate-pulse" />
                  )}
                  <span className="relative z-10 flex items-center gap-2">
                    {isBusy("ats") ? (
                      <>
                        <svg
                          className="w-4 h-4 animate-spin"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M4 12a8 8 0 018-8"
                          />
                        </svg>
                        Analyzing ATS...
                      </>
                    ) : (
                      <>
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M12 6v6l3 3m5-3a8 8 0 11-16 0 8 8 0 0116 0z"
                          />
                        </svg>
                        ATS Analysis
                      </>
                    )}
                  </span>
                </button>

                {/* Rewrite Button - محسن */}
                <button
                  onClick={() => handleCallApi("rewriteForJob")}
                  disabled={loading}
                  className={`relative px-5 py-2 rounded-xl text-xs md:text-sm font-semibold text-white overflow-hidden
                    ${
                      isBusy("rewrite")
                        ? "bg-emerald-500 cursor-wait"
                        : "bg-emerald-600 hover:bg-emerald-500"
                    }
                    disabled:opacity-60 disabled:cursor-not-allowed transition-transform duration-150 active:scale-[0.98]`}
                >
                  {isBusy("rewrite") && (
                    <span className="absolute inset-0 bg-emerald-400/20 animate-pulse" />
                  )}
                  <span className="relative z-10 flex items-center gap-2">
                    {isBusy("rewrite") ? (
                      <>
                        <svg
                          className="w-4 h-4 animate-spin"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M4 12a8 8 0 018-8"
                          />
                        </svg>
                        Rewriting...
                      </>
                    ) : (
                      <>
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M4 4h16v4H4zm0 6h10v4H4zm0 6h7v4H4z"
                          />
                        </svg>
                        Rewrite for this Job
                      </>
                    )}
                  </span>
                </button>
              </div>

              {error && (
                <p className="text-xs text-rose-400 mt-1">
                  {error}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Results grid */}
        <section className="grid gap-4 lg:grid-cols-2">
          {/* ATS Result card */}
          {atsResult && (
            <div className="bg-slate-900/70 border border-slate-700/70 rounded-2xl p-4 shadow-xl shadow-black/40">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-semibold tracking-wide text-slate-100">
                    ATS Compatibility
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    تحليل تطابق السيرة مع الوصف الوظيفي
                  </p>
                </div>
                {/* Score pill */}
                <div className="flex items-center gap-3">
                  <div
                    className={`w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold ${scoreColor(
                      atsResult.score,
                    )} shadow-lg shadow-black/40`}
                  >
                    {atsResult.score}
                  </div>
                  <div className="flex flex-col text-right text-[11px]">
                    <span className="font-semibold text-slate-100">
                      {scoreLabel(atsResult.score)}
                    </span>
                    <span className="text-slate-400">
                      Match level: {atsResult.match_level}
                    </span>
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden mb-3">
                <div
                  className={`h-2 rounded-full ${scoreColor(
                    atsResult.score,
                  )} transition-all`}
                  style={{
                    width: `${Math.min(
                      100,
                      Math.max(0, atsResult.score ?? 0),
                    )}%`,
                  }}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-3 mt-3">
                {/* Missing keywords */}
                <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-3">
                  <p className="text-[11px] font-semibold mb-1 text-slate-200">
                    Missing Keywords
                  </p>
                  {atsResult.missing_keywords.length === 0 ? (
                    <p className="text-[11px] text-emerald-400">
                      لا توجد كلمات مفقودة رئيسية 🎯
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {atsResult.missing_keywords.map((kw, i) => (
                        <span
                          key={i}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Issues */}
                <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-3">
                  <p className="text-[11px] font-semibold mb-1 text-slate-200">
                    Issues
                  </p>
                  {atsResult.issues.length === 0 ? (
                    <p className="text-[11px] text-emerald-400">
                      لا توجد مشاكل تنسيق أو محتوى حرجة ✅
                    </p>
                  ) : (
                    <ul className="text-[11px] text-slate-300 list-disc ml-4 space-y-1">
                      {atsResult.issues.map((issue, i) => (
                        <li key={i}>{issue}</li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Suggestions */}
                <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-3">
                  <p className="text-[11px] font-semibold mb-1 text-slate-200">
                    Suggestions
                  </p>
                  {atsResult.suggestions.length === 0 ? (
                    <p className="text-[11px] text-slate-400">
                      لا توجد ملاحظات إضافية حالياً.
                    </p>
                  ) : (
                    <ul className="text-[11px] text-slate-300 list-disc ml-4 space-y-1">
                      {atsResult.suggestions.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Rewritten resume card */}
          {rewrittenResume && (
            <div className="bg-slate-900/70 border border-slate-700/70 rounded-2xl p-4 shadow-xl shadow-black/40">
              <div className="flex items-center justify-between mb-3 gap-3">
                <div>
                  <h2 className="text-sm font-semibold tracking-wide text-slate-100">
                    Rewritten Resume
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    نسخة محسّنة ومهيكلة للسيرة الذاتية
                  </p>
                </div>

                <PdfDownloadButton
                  resumeText={rewrittenResume}
                  contactInfo={
                    contactInfo || {
                      fullName: "",
                      email: "",
                      phone: "",
                      linkedin: "",
                      location: "",
                    }
                  }
                  disabled={loading}
                />
              </div>

              {/* Contact info */}
              {contactInfo &&
                (contactInfo.fullName ||
                  contactInfo.email ||
                  contactInfo.phone) && (
                  <div className="mb-3 p-3 bg-slate-950/60 border border-slate-700 rounded-xl flex flex-col gap-1">
                    <p className="text-[11px] text-slate-400">
                      Contact info extracted from your resume:
                    </p>
                    <p className="text-sm font-medium text-slate-100">
                      {contactInfo.fullName}
                    </p>
                    <p className="text-[11px] text-slate-300">
                      {[contactInfo.email, contactInfo.phone, contactInfo.location]
                        .filter(Boolean)
                        .join(" | ")}
                    </p>
                    {contactInfo.linkedin && (
                      <p className="text-[11px] text-cyan-300">
                        {contactInfo.linkedin}
                      </p>
                    )}
                  </div>
                )}

              {/* Word count + warning */}
              {wordCount !== null && (
                <p className="text-[11px] mb-1 text-slate-300">
                  Word count:{" "}
                  <span className="font-semibold text-slate-50">
                    {wordCount}
                  </span>
                </p>
              )}

              {warning && wordCount !== null && (
                <p className="text-amber-400 text-[11px] mb-2">
                  ⚠️ الطول المثالي بين 450–700 كلمة. الحالي: {wordCount}.
                </p>
              )}

              {/* Text area */}
              <textarea
                readOnly
                value={rewrittenResume}
                className="w-full h-64 rounded-xl bg-slate-950/70 border border-slate-700 px-3 py-2 text-xs md:text-sm text-slate-100 outline-none"
              />
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
