import { NextResponse } from "next/server"

const GROQ_API_KEY = process.env.GROQ_API_KEY

if (!GROQ_API_KEY) {
  console.warn("⚠ GROQ_API_KEY is not set. ATS API will not work.")
}

type AtsPayload = {
  resume: string
  jobDescription: string
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

// نجعلها any عشان ما نتعب مع الـ types في الحقول القادمة
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
      // Last resort: try to extract key-value pairs manually
      const result: Record<string, unknown> = {}

      // Extract score
      const scoreMatch = content.match(/"score"\s*:\s*(\d+)/i)
      if (scoreMatch) result.score = Number.parseInt(scoreMatch[1])

      // Extract match_level
      const levelMatch = content.match(/"match_level"\s*:\s*"([^"]+)"/i)
      if (levelMatch) result.match_level = levelMatch[1]

      // Extract rewritten_resume
      const resumeMatch = content.match(/"rewritten_resume"\s*:\s*"([\s\S]*?)(?:"\s*[,}])/i)
      if (resumeMatch) result.rewritten_resume = resumeMatch[1].replace(/\\n/g, "\n")

      // Extract contact fields
      const nameMatch = content.match(/"fullName"\s*:\s*"([^"]*)"/i)
      if (nameMatch) result.fullName = nameMatch[1]

      const emailMatch = content.match(/"email"\s*:\s*"([^"]*)"/i)
      if (emailMatch) result.email = emailMatch[1]

      const phoneMatch = content.match(/"phone"\s*:\s*"([^"]*)"/i)
      if (phoneMatch) result.phone = phoneMatch[1]

      const linkedinMatch = content.match(/"linkedin"\s*:\s*"([^"]*)"/i)
      if (linkedinMatch) result.linkedin = linkedinMatch[1]

      const locationMatch = content.match(/"location"\s*:\s*"([^"]*)"/i)
      if (locationMatch) result.location = locationMatch[1]

      // Extract arrays
      const keywordsMatch = content.match(/"missing_keywords"\s*:\s*\[([\s\S]*?)\]/i)
      if (keywordsMatch) {
        const items = keywordsMatch[1].match(/"([^"]+)"/g)
        result.missing_keywords = items ? items.map((s) => s.replace(/"/g, "")) : []
      }

      const issuesMatch = content.match(/"issues"\s*:\s*\[([\s\S]*?)\]/i)
      if (issuesMatch) {
        const items = issuesMatch[1].match(/"([^"]+)"/g)
        if (items) result.issues = items.map((s) => s.replace(/"/g, ""))
      }

      const suggestionsMatch = content.match(/"suggestions"\s*:\s*\[([\s\S]*?)\]/i)
      if (suggestionsMatch) {
        const items = suggestionsMatch[1].match(/"([^"]+)"/g)
        if (items) result.suggestions = items.map((s) => s.replace(/"/g, ""))
      }

      if (Object.keys(result).length > 0) {
        return result
      }

      throw new Error("Could not parse response as JSON")
    }
  }
}

// دالة موحدة لحساب عدد الكلمات من النص نفسه
function countWords(text: string): number {
  if (!text) return 0

  // إزالة بعض الرموز اللي ما تعتبر كلمات
  const cleaned = text
    .replace(/[•■▪●◆◇◦–\-—]/g, " ") // bullets والشرطات
    .replace(/[^A-Za-z0-9\u0600-\u06FF]+/g, " ") // نخلي بس عربي/إنجليزي/أرقام
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

// 🔁 قوائم الموديلات مع fallback

const atsModels = [
  "llama-4-scout-17b-16e-instruc", // جديد – نحاول به أولاً
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
]

const contactModels = [
  "llama-3.1-8b-instant", // خفيف ورخيص كبداية
  "llama-4-scout-17b-16e-instruc",
  "llama-3.3-70b-versatile",
]

const rewriteModels = [
  "llama-4-scout-17b-16e-instruc", // الأساسي لإعادة الصياغة
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
      // نكمل للموديل اللي بعده
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

    if (!payload?.resume || !payload?.jobDescription) {
      return NextResponse.json(
        { error: "resume and jobDescription are required" },
        { status: 400 },
      )
    }

    switch (action) {
      // ===================== ATS ANALYZE =====================
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
- Be precise and practical: your output will be used by a real candidate to improve their resume.
- Focus on what hurts ATS parsing and recruiter screening the most.
- Clearly distinguish between:
  - Structural/formatting issues (that affect parsing)
  - Content/experience gaps (that affect relevance)
  - Missing keywords (phrases from the JD that are not clearly present)

RETURN JSON ONLY IN THIS FORMAT (no markdown, no prose outside the JSON):

{
  "score": 82,
  "match_level": "Strong",
  "dimension_scores": {
    "overall_ats_score": 82,
    "keyword_match_score": 85,
    "experience_alignment_score": 78,
    "formatting_compatibility_score": 88
  },
  "ats_structural_health": [
    "Standard reverse-chronological layout that ATS can parse reliably.",
    "Sections are clearly labeled and separated.",
    "No text embedded in images; content appears machine-readable."
  ],
  "key_strengths": [
    "Solid alignment with the target role responsibilities.",
    "Relevant industry/domain experience with matching terminology.",
    "Clear progression in responsibilities across roles."
  ],
  "critical_gaps": [
    "Limited mention of specific tools or platforms emphasized in the job description.",
    "Insufficient quantification of outcomes for key projects (impact, scale, or metrics)."
  ],
  "missing_keywords": [
    "Example keyword 1",
    "Example keyword 2"
  ],
  "issues": [
    "Dates formatting is inconsistent across roles.",
    "Some bullet points are too generic and lack measurable impact."
  ],
  "suggestions": [
    "Incorporate 5–8 core keywords from the job description into relevant experience bullets.",
    "Add 1–2 quantified outcomes to your most recent role to highlight impact (e.g., reliability, efficiency, cost savings).",
    "Unify date formatting (e.g., MMM YYYY – MMM YYYY) and keep section headings consistent."
  ]
}

IMPORTANT NOTES:
- "score" must be an integer from 0 to 100.
- "match_level" must be exactly one of: "Excellent", "Strong", "Okay", "Weak".
- "missing_keywords", "issues", and "suggestions" must each be a flat JSON array of strings.
- Use clear, concise English for all text fields.

RESUME:
${payload.resume}

JOB DESCRIPTION:
${payload.jobDescription}`

        // نستخدم max_tokens صغير عشان نوفر توكن – الرد JSON قصير
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

      // ===================== REWRITE FOR JOB =====================
      case "rewriteForJob": {
        // 1) استخراج معلومات التواصل
        const extractPrompt = `Extract contact information from this resume.

IMPORTANT: The full name is usually at the TOP of the resume, often in large text or as a header.
Look for Arabic names (e.g., "المعتز أبوطالب", "محمد أحمد") or English names (e.g., "John Smith").

Return ONLY this JSON format:
{"fullName": "Person Full Name", "email": "email@example.com", "phone": "+966...", "linkedin": "linkedin.com/in/...", "location": "City, Country"}

If a field is not found, use empty string "".

Resume text:
${payload.resume}`

        const contactContent = await callGroqWithFallback(
          contactModels,
          [
            {
              role: "system",
              content:
                "You extract contact info from resumes. The name is ALWAYS at the top. Return only valid JSON.",
            },
            { role: "user", content: extractPrompt },
          ],
          0,
          400, // استخراج معلومات تواصل بسيط → توكن أقل
        )

        const contactInfo = parseJsonSafe(contactContent)
        let fullName = (contactInfo.fullName as string) || ""

        if (!fullName) {
          const lines = payload.resume.split("\n").filter((l) => l.trim())
          if (lines.length > 0) {
            const firstLine = lines[0].trim()
            if (
              firstLine.length < 50 &&
              !firstLine.includes("@") &&
              !firstLine.match(/^\+?\d/) &&
              !firstLine.toLowerCase().includes("resume") &&
              !firstLine.toLowerCase().includes("cv")
            ) {
              fullName = firstLine
            }
          }
        }

        // 2) برومبت إعادة الصياغة محسَّن ليكون بجودة منافسين
        const rewritePrompt = `You are a senior, premium-level ATS resume writer working for a top-tier resume optimization platform.

GOAL:
Create a job-tailored, ATS-optimized resume that can compete with or outperform leading ATS tools.
Your writing must feel polished, confident, and impact-driven, while staying 100% truthful to the original resume.

TARGET LENGTH:
Try to keep the FINAL rewritten resume between 450 and 700 words (excluding contact info).
This range is recommended for ATS performance, but never sacrifice truthfulness or formatting rules just to hit a specific number.

QUALITY BAR / COMPETITION:
- Assume the candidate is competing against resumes written by professional paid services.
- Every bullet point must show clear VALUE: ownership, scope, and measurable or implied impact.
- Avoid vague or generic phrases ("responsible for", "helped with") unless you immediately follow them with a concrete result.
- Prefer strong, concise action verbs + outcomes.
- Integrate relevant keywords from the job description wherever they match the candidate's real experience.
- Keep language natural, modern, and professional — not robotic and not too flowery.

CRITICAL RULES - DO NOT VIOLATE:
1. NEVER fabricate skills, experience, or achievements not in the original resume.
2. NEVER add technologies, tools, or certifications the candidate doesn't have.
3. ONLY use information explicitly stated in the original resume.
4. If the original resume lacks details, expand on EXISTING accomplishments, don't invent new ones.
5. Reframe and optimize what EXISTS, never create what DOESN'T exist.
6. The job description is ONLY for alignment and keyword phrasing, NOT for adding new responsibilities.

STRICT FORMATTING SPECIFICATION:

SECTION HEADERS MUST BE EXACTLY (IN THIS ORDER):

PROFESSIONAL SUMMARY
CORE COMPETENCIES
PROFESSIONAL EXPERIENCE
EDUCATION
TECHNICAL SKILLS
LANGUAGES
CERTIFICATIONS

Do NOT rename or add extra main sections.
Each section header MUST be on its own line, all caps.
No emojis, no icons, no markdown (#, *, **, etc.).
Absolutely NO "|" pipe character anywhere in the resume body.

LAYOUT RULES:
Use a vertical, multi-line layout.
Put ONE empty line between sections.
Inside each section, each bullet or entry is on its own line.
Bullet points MUST start with: •  (bullet + space).
Do NOT collapse the entire resume into one long paragraph.

CONTACT INFO:
Do NOT include contact info inside the main resume body.
The platform will render contact info separately.
So do NOT write email, phone, or LinkedIn inside the resume text.

STRUCTURE (follow this EXACT order):

1. PROFESSIONAL SUMMARY (about 60–80 words)
- First sentence: "[X] years of experience in [field/industry]" (use the real years from the resume when possible).
- Emphasize seniority, domain expertise, and role alignment (e.g., electrical distribution, project management, power systems).
- Mention 2–3 core strengths that are clearly supported by the original resume.
- Naturally include 4–6 important keywords from the job description that match the candidate's real profile.

2. CORE COMPETENCIES (about 50–70 words)
- 8–12 key skills grouped into 2–3 lines.
- Only use skills present in the original resume (technical, functional, and soft skills that are explicitly mentioned).

3. PROFESSIONAL EXPERIENCE (about 280–350 words)
- List roles in reverse chronological order.
- For each role, first line:
  Job Title — Company — Dates
- Then 4–6 bullet points per role, each starting with "• ".
- Apply these rules for bullets:
  - Start with strong action verbs (Led, Designed, Implemented, Optimized, Coordinated, Delivered).
  - Clearly show scope (e.g., size of networks, number of projects, budgets, voltage levels).
  - Where the original resume provides any numbers or scales (MVA, SAR, # of projects), integrate them as proof of impact.
  - At least 1–2 bullets per role should highlight measurable or clearly implied outcomes (efficiency, reliability, cost savings, service quality, etc.).
  - Avoid repeating the same wording; vary verbs and phrasing across bullets.

4. EDUCATION (about 40–60 words)
- Degree, Institution, Country/City, Graduation Year.

5. TECHNICAL SKILLS (about 50–80 words)
- Organize by category.
- Only list technologies, tools, and standards explicitly mentioned in the original resume.

6. LANGUAGES (about 20–30 words)

7. CERTIFICATIONS (about 30–50 words)

WORD COUNT STRATEGY:
- If under 450 words, expand using only existing details.
- If over 700 words, compress by removing redundancy, not real experience.

FINAL JSON RESPONSE FORMAT (MANDATORY):
Return ONLY this JSON object, no markdown and no extra commentary:

{
  "rewritten_resume": "PROFESSIONAL SUMMARY\\n[content]\\n\\nCORE COMPETENCIES\\n[content]\\n\\nPROFESSIONAL EXPERIENCE\\n[content]\\n\\nEDUCATION\\n[content]\\n\\nTECHNICAL SKILLS\\n[content]\\n\\nLANGUAGES\\n[content]\\n\\nCERTIFICATIONS\\n[content if applicable]",
  "word_count": 650
}

ORIGINAL RESUME:
${payload.resume}

JOB DESCRIPTION:
${payload.jobDescription}`

        const MIN_WORDS_OK = 350
        const MAX_WORDS_OK = 750
        const WARNING_THRESHOLD = 450

        let lastRewritten = ""
        let lastWordCount = 0

        // محاولة واحدة فقط لكل موديل، مع fallback بين الموديلات
        const content = await callGroqWithFallback(
          rewriteModels,
          [
            {
              role: "system",
              content:
                "You are a premium ATS resume optimization engine. You follow all formatting rules, aim for 450–700 words, write impact-focused bullets, and NEVER fabricate information. Return only valid JSON.",
            },
            { role: "user", content: rewritePrompt },
          ],
          0.35,
          1600, // مساحة كافية لـ ~700 كلمة
        )

        const parsed = parseJsonSafe(content)

        const rewritten = (parsed.rewritten_resume as string) || ""
        lastRewritten = rewritten

        const wordCount = countWords(rewritten)
        lastWordCount = wordCount

        console.log(`[REWRITE] computed wordCount = ${wordCount}`)

        if (wordCount >= MIN_WORDS_OK && wordCount <= MAX_WORDS_OK) {
          const baseResponse: any = {
            rewritten_resume: rewritten,
            word_count: wordCount,
            contact_info: {
              fullName,
              email: (contactInfo.email as string) || "",
              phone: (contactInfo.phone as string) || "",
              linkedin: (contactInfo.linkedin as string) || "",
              location: (contactInfo.location as string) || "",
            },
          }

          if (wordCount < WARNING_THRESHOLD) {
            baseResponse.warning = "WORD_COUNT_BELOW_RECOMMENDED_RANGE_450_700"
          }

          return NextResponse.json(baseResponse)
        }

        // لو خارج النطاق حتى بعد كل الـ fallback
        return NextResponse.json(
          {
            error: `LENGTH_CONSTRAINT_VIOLATION_AFTER_FALLBACK_MODELS`,
            rewritten_resume: lastRewritten,
            word_count: lastWordCount,
          },
          { status: 500 },
        )
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
