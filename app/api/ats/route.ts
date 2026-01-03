import { NextResponse } from "next/server"

const GROQ_API_KEY = process.env.GROQ_API_KEY

if (!GROQ_API_KEY) {
  console.warn("⚠ GROQ_API_KEY is not set. ATS API will not work.")
}

type AtsPayload = {
  resume: string
  jobDescription?: string
}

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

function countWords(text: string): number {
  if (!text) return 0

  const cleaned = text
    .replace(/[•■▪●◆◇◦–\-—]/g, " ")
    .replace(/[^A-Za-z0-9\u0600-\u06FF]+/g, " ")
    .trim()

  if (!cleaned) return 0

  return cleaned.split(/\s+/).filter(Boolean).length
}

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

const rewriteModels = [
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
]

async function callGroqWithFallback(
  models: string[],
  messages: { role: string; content: string }[],
  temperature: number,
  maxTokens: number,
) {
  let lastError: unknown

  for (const model of models) {
    try {
      console.log(`[Groq] Trying model: ${model}`)
      const result = await callGroqChat(model, messages, temperature, maxTokens)
      console.log(`[Groq] Model ${model} succeeded`)
      return result
    } catch (err) {
      lastError = err
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[Groq] Model ${model} failed: ${msg}`)
      continue
    }
  }

  throw lastError ?? new Error("All Groq models failed")
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { action, payload } = body as {
      action: string
      payload: AtsPayload
    }

    // نخلي jobDescription اختياري، لكن resume لازم
    if (!payload?.resume) {
      return NextResponse.json(
        { error: "resume is required" },
        { status: 400 },
      )
    }

    const jobDesc = payload.jobDescription ?? ""

    switch (action) {
      // =============== ATS ANALYZE ===============
      case "analyzeATS": {
        const prompt = `You are an advanced ATS analysis engine competing with top commercial tools.

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

OUTPUT REQUIREMENTS:
Return ONLY JSON in exactly this shape:

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
${payload.resume}

JOB DESCRIPTION:
${jobDesc}`

        const content = await callGroqWithFallback(
          atsModels,
          [
            {
              role: "system",
              content:
                "You are an ATS analysis engine. Return only strict JSON following the user schema, no markdown, no extra prose.",
            },
            { role: "user", content: prompt },
          ],
          0.2,
          600,
        )

        const parsed = parseJsonSafe(content)
        return NextResponse.json(parsed)
      }

      // =============== REWRITE FOR JOB (تحسين السيرة) ===============
      case "rewriteForJob": {
        const rewritePrompt = `
You are a senior, premium-level ATS resume writer working for a top-tier resume optimization platform.
Your job has TWO outputs only: Contact extraction + Final rewritten resume.

You must follow every instruction below with zero deviations.

====================================================
PART 1 — CONTACT INFO EXTRACTION (STRICT)

Extract ONLY what exists in the original resume text (do NOT invent or assume):

full_name
phone
email
location
linkedin

If any field is missing, return it as an empty string.
Do NOT clean, normalize, or modify values — extract them exactly as written except trimming whitespace.

====================================================
PART 2 — REWRITE THE RESUME (STRICT RULES)

GOAL
Rewrite the resume into a high-impact, ATS-optimized resume while staying 100% truthful to the original content.

The tone must be polished, confident, and measurable where possible — similar to resumes produced by premium professional writers.

MANDATORY WORD COUNT RULE
The FINAL resume body (excluding contact info) MUST be between 500 and 700 words.

If the word count is < 500 → expand naturally using ONLY existing information.
If > 700 → compress wording WITHOUT deleting real experience or truth.

Do NOT ever:
1. Invent information, metrics, or tools.
2. Add certifications that don’t exist.
3. Copy duties from job descriptions directly.
4. Add new sections.
5. Add contact info inside the resume body.

STRICT SECTION ORDER (MUST MATCH EXACTLY)

The final resume MUST contain ONLY these sections in this exact order and format:

PROFESSIONAL SUMMARY
CORE COMPETENCIES
PROFESSIONAL EXPERIENCE
EDUCATION
TECHNICAL SKILLS
LANGUAGES
CERTIFICATIONS

RULES FOR HEADERS

- ALL CAPS
- Each header on its own line
- One blank line between sections

FORMATTING RULES (NON-NEGOTIABLE)

- Inside sections:
  - Bullet points MUST start EXACTLY with: •  (bullet + space)
  - No emojis, no markdown, no tables.
  - No pipe character “|” anywhere in the resume body.
  - Layout must be vertical multi-line (no single long paragraph).
- Do NOT include contact info in the resume text.
- The first sentence of PROFESSIONAL SUMMARY must begin with:
  "[X] years of experience in …" using the real number of years from the resume when possible.

JOB DESCRIPTION USAGE:
- You may use the job description ONLY to align wording and highlight relevant experience.
- You MUST NOT copy responsibilities directly from the job description.
- You MUST NOT add experience or tools that do not exist in the original resume.

VALIDATION STEP (INTERNAL BEFORE RESPONDING)
Before you answer, internally verify that:
- Word count is between 500–700.
- Section headers exactly match the required ones and in correct order.
- No extra sections exist.
- Bullets use "• " only.
- No pipe character exists.
- No contact info inside resume body.

====================================================
FINAL OUTPUT FORMAT (MANDATORY — JSON ONLY)

Return ONLY this JSON:

{
  "contact": {
    "full_name": "",
    "phone": "",
    "email": "",
    "location": "",
    "linkedin": ""
  },
  "final_resume": "FINAL ATS-OPTIMIZED RESUME TEXT FOLLOWING ALL RULES HERE",
  "word_count": 600
}

====================================================

ORIGINAL RESUME:
"""
${payload.resume}
"""

JOB DESCRIPTION:
"""
${jobDesc}
"""
`

        const content = await callGroqWithFallback(
          rewriteModels,
          [
            {
              role: "system",
              content:
                "You are a premium ATS resume optimization engine. You MUST follow the user instructions exactly and return ONLY valid JSON. No markdown, no commentary.",
            },
            { role: "user", content: rewritePrompt },
          ],
          0.35,
          2000,
        )

        const parsed = parseJsonSafe(content)

        const contact = parsed.contact ?? {
          full_name: "",
          phone: "",
          email: "",
          location: "",
          linkedin: "",
        }

        const finalResume: string = parsed.final_resume ?? ""
        const computedWordCount = countWords(finalResume)

        return NextResponse.json({
          contact: {
            full_name: contact.full_name ?? "",
            phone: contact.phone ?? "",
            email: contact.email ?? "",
            location: contact.location ?? "",
            linkedin: contact.linkedin ?? "",
          },
          // عشان التوافق مع الكود القديم:
          rewritten_resume: finalResume,
          final_resume: finalResume,
          word_count: computedWordCount,
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
