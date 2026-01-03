import { NextResponse } from "next/server"

const GROQ_API_KEY = process.env.GROQ_API_KEY

if (!GROQ_API_KEY) {
  console.warn("⚠ GROQ_API_KEY is not set. ATS API will not work.")
}

type AtsPayload = {
  resume: string
  jobDescription?: string
  rewritePrompt?: string // لو حبيت مستقبلاً تمرر برومبت مخصص من الواجهة
}

function extractAndCleanJson(str: string): string {
  // Remove markdown code blocks
  let cleaned = str
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim()

  // Find JSON object boundaries
  const startIndex = cleaned.indexOf("{")
  const endIndex = cleaned.lastIndexOf("}")

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error("No valid JSON object found in response")
  }

  cleaned = cleaned.substring(startIndex, endIndex + 1)

  // Replace problematic characters inside string values
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

// parser عام لنتائج الموديل
function parseJsonSafe(content: string): any {
  // First try direct parsing
  try {
    return JSON.parse(content.trim())
  } catch {
    // Try cleaning and extracting
    try {
      const cleaned = extractAndCleanJson(content)
      return JSON.parse(cleaned)
    } catch {
      throw new Error("Could not parse response as JSON")
    }
  }
}

// دالة موحدة لحساب عدد الكلمات من النص نفسه
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

// موديلات ATS مع fallback
const atsModels = [
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

    if (!payload?.resume) {
      return NextResponse.json(
        { error: "resume is required" },
        { status: 400 },
      )
    }

    const resume = payload.resume
    const jobDescription = payload.jobDescription ?? ""

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
${resume}

JOB DESCRIPTION:
${jobDescription}`

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

      // =============== REWRITE FOR JOB (نفس منطق HTML) ===============
      case "rewriteForJob": {
        // برومبت HTML اللي عطيتني إياه حرفيًا
        const DEFAULT_HTML_PROMPT = `
You are a Senior Executive Recruiter and ATS Auditor.
Your job is to audit and rewrite the following resume into a high-performance, ATS-safe resume.
The resume may belong to ANY profession, seniority level, or country.
You may rephrase, restructure, and clarify the text — BUT YOU MUST NOT invent or assume ANY new information.
Do NOT add new job titles, responsibilities, projects, tools, certifications, duties, or metrics that are not already clearly implied by the original resume.
STRICT WORD COUNT REQUIREMENT
The FINAL rewritten resume text MUST be between 500 and 700 words (inclusive).
Never generate fewer than 500 words.
Never exceed 700 words.
If needed, expand wording ONLY using information that already exists in the resume.
You MUST internally count words before responding and ONLY return output that is between 500–700 words.
ATS FORMATTING RULES
The rewritten resume must:
• Be ATS-safe
• Be written in English unless the source resume is fully in another language
• Be clear, structured, and impact-driven
• Maintain a vertical multi-line layout
• Use only plain-text characters
• No markdown
• No emojis
• No HTML
• No decorative symbols
• No pipe character |
SECTION HEADERS MUST USE CLEAR UPPERCASE such as:
PROFESSIONAL SUMMARY
EXPERIENCE
SKILLS
EDUCATION
CERTIFICATIONS
LANGUAGES
Each must be on its own line.
Insert one blank line between sections.
Inside sections, bullet entries must begin with:

CONTACT INFO RULE
Extract contact details ONLY if they exist in the resume.
Do NOT invent missing fields.
INPUT
Resume: """ {{USER_RESUME_TEXT}} """
OUTPUT FORMAT
Return ONLY a valid JSON object using the EXACT structure below.
Do NOT add any commentary or text outside the JSON.
Do NOT wrap JSON in code blocks.
{ "contact": { "full_name": "", "email": "", "phone": "", "location": "", "linkedin": "" }, "final_resume": "THE FULL REWRITTEN ATS RESUME HERE — BETWEEN 500 AND 700 WORDS ONLY" }
CONTACT JSON RULES
Extract values EXACTLY as written in the resume (except trimming spaces).
If a field does not exist, return an empty string.
Do NOT infer or guess missing data.
VALIDATION BEFORE RESPONDING
Before returning your answer, you MUST verify that:
• The JSON structure is valid
• Word count in final_resume is between 500–700 words
• No fields contain hallucinated information
• No pipe characters exist
• No markdown exists
• Resume structure follows all formatting rules
• Only the JSON object is returned
If the resume is too short, EXPAND ONLY based on existing information — never invent.
If word count is below 500 or above 700, FIX IT before responding.
        `.trim()

        // لو حبيت من الواجهة ترسل rewritePrompt مخصص، نستخدمه، غير كذا نستخدم البرومبت الافتراضي
        const promptTemplate =
          (payload.rewritePrompt && payload.rewritePrompt.trim().length > 0
            ? payload.rewritePrompt
            : DEFAULT_HTML_PROMPT)

        // نستبدل {{USER_RESUME_TEXT}} بالنص الفعلي للسيرة
        const effectivePrompt = promptTemplate.replace(
          "{{USER_RESUME_TEXT}}",
          resume,
        )

        // نرسل للموديل بنفس أسلوب HTML: برومبت كامل في رسالة user أو system (نختار user هنا)
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

        const contact = parsed.contact ?? {
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

        const wordCount = countWords(finalResume)

        return NextResponse.json({
          contact: {
            full_name: contact.full_name ?? "",
            email: contact.email ?? "",
            phone: contact.phone ?? "",
            location: contact.location ?? "",
            linkedin: contact.linkedin ?? "",
          },
          final_resume: finalResume,
          rewritten_resume: finalResume, // للتوافق مع أي كود قديم
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
