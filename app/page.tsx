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
  const [error, setError] = useState<string | null>(null)
  const [contactInfo, setContactInfo] = useState<ContactInfo | null>(null)

  // ✅ word count للسيرة المحسّنة
  const [wordCount, setWordCount] = useState<number | null>(null)

  const isBusy = (name: "ats" | "rewrite") => loading && activeAction === name

  // ✅ التحقق من صلاحية عدد الكلمات (500–700)
  const isWordCountValid =
    wordCount === null || (wordCount >= 500 && wordCount <= 700)

  const handleCallApi = async (action: "analyzeATS" | "rewriteForJob") => {
    setError(null)
    setAtsResult(null)

    if (action === "rewriteForJob") {
      setRewrittenResume("")
      setContactInfo(null)
      setWordCount(null)
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
        // ✅ نتيجة تحليل ATS
        setAtsResult({
          score: data.score,
          match_level: data.match_level,
          missing_keywords: data.missing_keywords || [],
          issues: data.issues || [],
          suggestions: data.suggestions || [],
        })
      } else {
        // ✅ نتيجة إعادة الصياغة + عدد الكلمات + معلومات التواصل
        const wc =
          typeof data.word_count === "number" ? data.word_count : null

        setWordCount(wc)
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

        // إذا عدد الكلمات معروف وخارج المدى، نعرض تحذير
        if (wc !== null && (wc < 500 || wc > 700)) {
          setError(
            `Optimized resume has ${wc} words. It MUST be between 500 and 700 words before export.`,
          )
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

  return (
    <main className="min-h-screen p-6 flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-center mb-2">
        Smart ATS Resume Analyzer
      </h1>
      <p className="text-center text-sm text-gray-600 mb-4">
        Paste your resume and job description, then run ATS analysis or AI rewriting.
      </p>

      <div className="max-w-4xl mx-auto w-full space-y-4">
        {/* RESUME INPUT */}
        <div>
          <label className="block text-sm font-semibold mb-1">
            Resume (Text)
          </label>
          <textarea
            value={resumeText}
            onChange={(e) => setResumeText(e.target.value)}
            className="w-full h-40 border border-slate-300 rounded-md p-2 text-sm"
            placeholder="Paste your resume here (including your name, email, phone, etc.)..."
          />
        </div>

        {/* JD INPUT */}
        <div>
          <label className="block text-sm font-semibold mb-1">
            Job Description
          </label>
          <textarea
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            className="w-full h-32 border border-slate-300 rounded-md p-2 text-sm"
            placeholder="Paste the target job description here..."
          />
        </div>

        {/* ACTION BUTTONS */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => handleCallApi("analyzeATS")}
            disabled={loading}
            className={`px-4 py-2 rounded-md text-sm font-semibold text-white ${
              isBusy("ats") ? "bg-blue-400" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {isBusy("ats") ? "Analyzing..." : "Analyze ATS"}
          </button>

          <button
            onClick={() => handleCallApi("rewriteForJob")}
            disabled={loading}
            className={`px-4 py-2 rounded-md text-sm font-semibold text-white ${
              isBusy("rewrite")
                ? "bg-emerald-400"
                : "bg-emerald-600 hover:bg-emerald-700"
            }`}
          >
            {isBusy("rewrite") ? "Rewriting..." : "Rewrite for this Job"}
          </button>
        </div>

        {/* ERROR */}
        {error && (
          <p className="text-sm text-red-600 mt-2">
            {error}
          </p>
        )}

        {/* ATS RESULT */}
        {atsResult && (
          <div className="mt-4 border border-slate-200 rounded-md p-3 bg-white">
            <h2 className="font-semibold mb-2">ATS Result</h2>
            <p className="text-lg font-bold">
              Score: {atsResult.score} / 100
            </p>
            <p className="text-sm text-gray-700 mb-2">
              Match level: {atsResult.match_level}
            </p>

            {atsResult.missing_keywords.length > 0 && (
              <div className="mb-2">
                <p className="text-sm font-semibold">Missing keywords:</p>
                <ul className="text-sm list-disc ml-5">
                  {atsResult.missing_keywords.map((kw, i) => (
                    <li key={i}>{kw}</li>
                  ))}
                </ul>
              </div>
            )}

            {atsResult.issues.length > 0 && (
              <div className="mb-2">
                <p className="text-sm font-semibold">Issues:</p>
                <ul className="text-sm list-disc ml-5">
                  {atsResult.issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}

            {atsResult.suggestions.length > 0 && (
              <div>
                <p className="text-sm font-semibold">Suggestions:</p>
                <ul className="text-sm list-disc ml-5">
                  {atsResult.suggestions.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* REWRITTEN RESUME */}
        {rewrittenResume && (
          <div className="mt-4 border border-slate-200 rounded-md p-4 bg-white">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Rewritten Resume</h2>

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
                // ✅ نمنع التحميل إذا عدد الكلمات خارج النطاق
                disabled={loading || !isWordCountValid}
              />
            </div>

            {/* عرض معلومات التواصل المستخرَجة */}
            {contactInfo &&
              (contactInfo.fullName ||
                contactInfo.email ||
                contactInfo.phone) && (
                <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
                  <p className="text-xs text-blue-600 font-semibold mb-1">
                    Contact info extracted from your resume:
                  </p>
                  <p className="text-sm text-blue-800 font-medium">
                    {contactInfo.fullName}
                  </p>
                  <p className="text-xs text-blue-700">
                    {[contactInfo.email, contactInfo.phone, contactInfo.location]
                      .filter(Boolean)
                      .join(" | ")}
                  </p>
                  {contactInfo.linkedin && (
                    <p className="text-xs text-blue-600">
                      {contactInfo.linkedin}
                    </p>
                  )}
                </div>
              )}

            {/* ✅ عرض عدد الكلمات وحالة القبول */}
            {wordCount !== null && (
              <p
                className={`text-xs mb-2 ${
                  isWordCountValid ? "text-emerald-600" : "text-red-600"
                }`}
              >
                Word count: {wordCount} (required: 500–700 words)
              </p>
            )}

            {/* النص نفسه */}
            <textarea
              readOnly
              value={rewrittenResume}
              className="w-full h-48 border border-slate-200 rounded-md p-2 text-sm"
            />
          </div>
        )}
      </div>
    </main>
  )
}
