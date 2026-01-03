
import { NextResponse } from "next/server"

const GROQ_API_KEY = process.env.GROQ_API_KEY

if (!GROQ_API_KEY) {
  console.warn("⚠ GROQ_API_KEY is not set. ATS API will not work.")
}

type AtsPayload = {
  resume: string
  jobDescription?: string
  rewritePrompt?: string
}

// ----------------- Helpers: JSON parsing -----------------

function extractAndCleanJson(str: string): string {
  let cleaned = str
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim()

  const startIndex = cleaned.indexOf("{")
  const endIndex = cleaned.lastIndexOf("}")

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error("No valid JSON object found in response")
  }

  cleaned = cleaned.substring(startIndex, endIndex + 1)

  cleaned = cleaned.replace(/:\s*"([^"]*)"/g, (match, content) => {
    const safeContent = content
      .replace(/\n/g, " ")
      .replace(/\r/g, " ")
      .replace(/\t/g, " ")
      .replace(/\\/g, "\\\\")
    return `: "${safeContent}"`
  })

  return cleaned
}

function parseJsonSafe(content: string): any {
  try {
    return JSON.parse(content.trim())
  } catch {
    try {
      const cleaned = extractAndCleanJson(content)
      return JSON.parse(cleaned)
    } catch {
      throw new Error("Could not parse response as JSON")
    }
  }
}

// ----------------- Helpers: word counting -----------------

function countWords(text: string): number {
  if (!text) return 0

  const cleaned = text
    .replace(/[•■▪●◆◇◦–\-—]/g, " ")
    .replace(/[^A-Za-z0-9\u0600-\u06FF]+/g, " ")
    .trim()

  if (!cleaned) return 0

  return cleaned.split(/\s+/).filter(Boolean).length
}

// ----------------- Helpers: contact extraction -----------------

function enhanceContactFromResume(
  resume: string,
  contact: {
    full_name?: string
    email?: string
    phone?: string
    location?: string
    linkedin?: string
  },
) {
  const updated = { ...contact }

  const text = resume || ""
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)

  // Email
  if (!updated.email) {
    const emailMatch = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)
    if (emailMatch) updated.email = emailMatch[0]
  }

  // Phone
  if (!updated.phone) {
    const phoneMatch = text.match(/(\+?\d[\d\s\-()]{7,})/)
    if (phoneMatch) updated.phone = phoneMatch[0].trim()
  }

  // LinkedIn
  if (!updated.linkedin) {
    const linkedinMatch = text.match(/(https?:\/\/)?[a-zA-Z0-9.\-]*linkedin\.com\/[^\s]+/i)
    if (linkedinMatch) {
      updated.linkedin = linkedinMatch[0]
    } else {
      const textMatch = text.match(/linkedin\.com\/[^\s]+/i)
      if (textMatch) updated.linkedin = textMatch[0]
    }
  }

  // Full name (أول سطر معقول)
  if (!updated.full_name) {
    const nameLine = lines.find((line) => {
      if (line.length > 60) return false
      if (/@/i.test(line)) return false
      if (/\d/.test(line)) return false
      const lower = line.toLowerCase()
      if (
        lower.includes("resume") ||
        lower.includes("curriculum vitae") ||
        lower.includes("cv")
      ) {
        return false
      }
      return true
    })
    if (nameLine) updated.full_name = nameLine
  }

  return updated
}

// ----------------- Helpers: Groq call -----------------

async function callGroqChat(
  model: string,
  messages: { role: string; content: string }[],
  temperature = 0.5,
  maxTokens = 2200,
) {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is missing")
  }

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Groq API error (${res.status}): ${text}`)
  }

  const json = await res.json()
  const content = json.choices?.[0]?.message?.content
  if (!content) throw new Error("No content from Groq")

  return content as string
}

const atsModels = [
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
]

// 🔥 هذا البرومبت مطابق لفكرة الكود الأول من ناحية ترتيب الأقسام والتنسيق
const DEFAULT_REWRITE_PROMPT = `
You are a senior, premium-level ATS resume writer working for a top-tier resume optimization platform.

GOAL:
Rewrite the resume into a high-impact, ATS-optimized resume while staying 100% truthful to the original content.
The tone must be polished, confident, and measurable where possible — similar to resumes produced by premium professional writers.

MANDATORY WORD COUNT RULE:
The FINAL resume body (excluding contact info) MUST be between 500 and 700 words.
If the word count is < 500, expand using ONLY existing information.
If the word count is > 700, compress wording WITHOUT deleting real experience.

DO NOT EVER:
1. Invent information, metrics, or tools.
2. Add certifications that don’t exist.
3. Copy duties from job descriptions.
4. Add new sections.
5. Add contact info inside the resume body.

STRICT SECTION ORDER (MUST MATCH EXACTLY):

The final resume MUST contain ONLY these sections in this exact order and format:

PROFESSIONAL SUMMARY
CORE COMPETENCIES
PROFESSIONAL EXPERIENCE
EDUCATION
TECHNICAL SKILLS
LANGUAGES
CERTIFICATIONS

RULES FOR HEADERS:
- ALL CAPS.
- On their own line.
- Blank line between sections.

FORMATTING RULES:
- Use plain text only.
- No markdown.
- No emojis.
- No HTML.
- No "|" pipe character anywhere in the resume body.
- Layout must be vertical and multi-line.
- Inside sections, each bullet or entry on its own line.
- Bullet points MUST start with: •  (bullet + space).

SUMMARY RULE:
The first sentence of PROFESSIONAL SUMMARY must begin with:
"[X] years of experience in …"
using the real number of years from the original resume.

EXPERIENCE RULES:
For each role use the format:
Job Title — Company — Dates
Then 4–6 bullet points per role, each starting with "• ".
Bullets must show scope, responsibilities, and impact using only real information from the original resume.

CONTACT & JSON OUTPUT:

You must extract basic contact info from the resume text if it exists:
- full_name
- email
- phone
- location
- linkedin

If any field is missing, return it as an empty string.
Do NOT invent or guess values.
Extract the values exactly as written (except trimming spaces).

INPUT RESUME:
"""{{USER_RESUME_TEXT}}"""

FINAL OUTPUT FORMAT (JSON ONLY):

Return ONLY this JSON object:

{
  "contact": {
    "full_name": "",
    "phone": "",
    "email": "",
    "location": "",
    "linkedin": ""
  },
  "final_resume": "FINAL ATS-OPTIMIZED RESUME TEXT FOLLOWING ALL RULES HERE"
}

VALIDATION BEFORE RESPONDING (MANDATORY):
- "final_resume" is between 500 and 700 words.
- All required section headers exist in the exact order listed.
- No extra main sections were added.
- All bullets start with "• ".
- No "|" character exists.
- No contact info appears inside "final_resume".
- Only the JSON object is returned, with no extra text.
`.trim()

// ----------------- ATS ANALYZE PROMPT -----------------

const ATS_ANALYZE_PROMPT = (resume: string, jobDescription: string) => `
You are an advanced ATS analysis engine competing with top commercial tools.

TASK:
Deeply analyze the following resume against the job description and return a structured ATS report.

EVALUATION DIMENSIONS:
1) Overall ATS compatibility
2) Keyword & skills match
3) Experience alignment with role level and responsibilities
4) Structural and formatting compatibility for ATS parsing

SCORING LOGIC (GUIDELINE, NOT EXHAUSTIVE):
- Start from 100 and subtract penalties.
- Missing MUST-HAVE / hard requirements: -5 to -10 each depending on severity.
- Missing NICE-TO-HAVE / preferred items: -2 to -4 each.
- Weak or mismatched experience for seniority/role: -10 to -20.
- Major formatting / parsing risks (tables, columns, heavy graphics, unreadable sections): -5 to -15.
- Minor formatting issues (inconsistent bullets, spacing, mixed date styles): -1 to -3 each.

MATCH LEVEL (based on final score):
- 85–100: "Excellent"
- 70–84: "Strong"
- 50–69: "Okay"
- 0–49: "Weak"

RETURN JSON ONLY IN THIS FORMAT:

{
  "score": 82,
  "match_level": "Strong",
  "dimension_scores": {
    "overall_ats_score": 82,
    "keyword_match_score": 85,
    "experience_alignment_score": 78,
    "formatting_compatibility_score": 88
  },
  "ats_structural_health": [],
  "key_strengths": [],
  "critical_gaps": [],
  "missing_keywords": [],
  "issues": [],
  "suggestions": []
}

RESUME:
${resume}

JOB DESCRIPTION:
${jobDescription}
`.trim()

// ----------------- API HANDLER -----------------

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { action, payload } = body as {
      action: string
      payload: AtsPayload
    }

    if (!payload?.resume) {
      return NextResponse.json(
        { error: "resume is required" },
        { status: 400 },
      )
    }

    const resume = payload.resume
    const jobDescription = payload.jobDescription ?? ""

    switch (action) {
      // ====== ATS ANALYZE ======
      case "analyzeATS": {
        if (!jobDescription) {
          return NextResponse.json(
            { error: "jobDescription is required for analyzeATS" },
            { status: 400 },
          )
        }

        const prompt = ATS_ANALYZE_PROMPT(resume, jobDescription)

        const content = await callGroqChat(
          "meta-llama/llama-4-scout-17b-16e-instruct",
          [
            {
              role: "system",
              content:
                "You are an ATS analysis engine. Return only strict JSON following the user schema, no markdown, no extra prose.",
            },
            { role: "user", content: prompt },
          ],
          0.2,
          700,
        )

        const parsed = parseJsonSafe(content)
        return NextResponse.json(parsed)
      }

      // ====== REWRITE FOR JOB (تحسين السيرة) ======
      case "rewriteForJob": {
        const promptTemplate =
          (payload.rewritePrompt && payload.rewritePrompt.trim().length > 0
            ? payload.rewritePrompt
            : DEFAULT_REWRITE_PROMPT)

        const effectivePrompt = promptTemplate.replace(
          "{{USER_RESUME_TEXT}}",
          resume,
        )

        const rawContent = await callGroqChat(
          "meta-llama/llama-4-scout-17b-16e-instruct",
          [
            {
              role: "user",
              content: effectivePrompt,
            },
          ],
          0.35,
          2000,
        )

        const parsed = parseJsonSafe(rawContent)

        const baseContact = parsed.contact ?? {
          full_name: "",
          email: "",
          phone: "",
          location: "",
          linkedin: "",
        }

        let finalResume: string =
          parsed.final_resume ||
          parsed.rewritten_resume ||
          parsed.CV ||
          ""

        finalResume = (finalResume || "").trim()

        // نشيل أي pipe بس، بدون ما نلعب في ترتيب السطور
        finalResume = finalResume.replace(/\|/g, ",")

        const contactFromOriginal = enhanceContactFromResume(resume, baseContact)
        const contactFromImproved = enhanceContactFromResume(finalResume, contactFromOriginal)

        const wordCount = countWords(finalResume)

        const contactSnake = {
          full_name: contactFromImproved.full_name ?? "",
          email: contactFromImproved.email ?? "",
          phone: contactFromImproved.phone ?? "",
          location: contactFromImproved.location ?? "",
          linkedin: contactFromImproved.linkedin ?? "",
        }

        const contactCamel = {
          fullName: contactSnake.full_name,
          email: contactSnake.email,
          phone: contactSnake.phone,
          location: contactSnake.location,
          linkedin: contactSnake.linkedin,
        }

        return NextResponse.json({
          contact: contactSnake,      // snake_case
          contact_info: contactCamel, // camelCase للفرونت
          final_resume: finalResume,
          rewritten_resume: finalResume,
          word_count: wordCount,
          model_used: "meta-llama/llama-4-scout-17b-16e-instruct",
        })
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 })
    }
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : "Server error"
    console.error("ATS API error:", errorMessage)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
