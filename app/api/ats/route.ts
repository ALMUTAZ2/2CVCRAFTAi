import { NextResponse } from "next/server"

const GROQ_API_KEY = process.env.GROQ_API_KEY

if (!GROQ_API_KEY) {
  console.warn("⚠ GROQ_API_KEY is not set. ATS API will not work.")
}

type AtsPayload = {
  resume: string
  jobDescription: string
}

/**
 * يحاول تنظيف النص من أي Markdown و يقتنص جسم الـ JSON
 */
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

/**
 * بارسر عام بسيط للـ JSON – مفيد في ردود analyzeATS / rewriteForJob
 */
function parseJsonSafe(content: string): Record<string, any> {
  try {
    return JSON.parse(content.trim())
  } catch {
    try {
      const cleaned = extractAndCleanJson(content)
      return JSON.parse(cleaned)
    } catch {
      const result: Record<string, unknown> = {}

      const scoreMatch = content.match(/"score"\s*:\s*(\d+)/i)
      if (scoreMatch) result.score = Number.parseInt(scoreMatch[1])

      const levelMatch = content.match(/"match_level"\s*:\s*"([^"]+)"/i)
      if (levelMatch) result.match_level = levelMatch[1]

      const resumeMatch = content.match(/"rewritten_resume"\s*:\s*"([\s\S]*?)(?:"\s*[,}])/i)
      if (resumeMatch) result.rewritten_resume = resumeMatch[1].replace(/\\n/g, "\n")

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

/**
 * استدعاء Groq Chat API – مع خيار تشغيل JSON mode
 */
async function callGroqChat(
  model: string,
  messages: { role: string; content: string }[],
  temperature = 0.2,
  jsonMode = false
) {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is missing")
  }

  const body: any = {
    model,
    messages,
    temperature,
    max_tokens: 4000,
  }

  // نفعل JSON mode لو نبيه يرجع JSON مضبوط
  if (jsonMode) {
    body.response_format = { type: "json_object" }
  }

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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

/**
 * دالة مساعدة لحساب عدد الكلمات
 */
function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { action, payload } = body as {
      action: string
      payload: AtsPayload
    }

    if (!payload?.resume || !payload?.jobDescription) {
      return NextResponse.json({ error: "resume and jobDescription are required" }, { status: 400 })
    }

    switch (action) {
      // 1) تحليل ATS بسيط وسريع
      case "analyzeATS": {
        const prompt = `Analyze this resume against the job description. Score from 0-100.

SCORING:
- Start at 100
- -5 for each missing required skill
- -3 for each missing preferred skill
- -10 if experience doesn't match
- -5 for formatting issues

MATCH LEVELS: 85-100="Excellent", 70-84="Strong", 50-69="Okay", 0-49="Weak"

Return JSON only, no markdown:
{"score": 75, "match_level": "Strong", "missing_keywords": ["skill1", "skill2"], "issues": ["issue1"], "suggestions": ["suggestion1"]}

RESUME:
${payload.resume}

JOB:
${payload.jobDescription}`

        const content = await callGroqChat(
          "llama-3.1-8b-instant",
          [
            { role: "system", content: "You are an ATS. Return only valid JSON, no explanation." },
            { role: "user", content: prompt },
          ],
          0,
          true,
        )

        const parsed = parseJsonSafe(content)
        return NextResponse.json(parsed)
      }

      // 2) إعادة كتابة السيرة للوظيفة مع شرط 500–700 كلمة
      case "rewriteForJob": {
        const extractPrompt = `Extract contact information from this resume.

IMPORTANT: The full name is usually at the TOP of the resume, often in large text or as a header.
Look for Arabic names (e.g., "المعتز أبوطالب", "محمد أحمد") or English names (e.g., "John Smith").

Return ONLY this JSON format:
{"fullName": "Person Full Name", "email": "email@example.com", "phone": "+966...", "linkedin": "linkedin.com/in/...", "location": "City, Country"}

If a field is not found, use empty string "".

Resume text:
${payload.resume}`

        const contactContent = await callGroqChat(
          "llama-3.1-8b-instant",
          [
            {
              role: "system",
              content: "You extract contact info from resumes. The name is ALWAYS at the top. Return only valid JSON.",
            },
            { role: "user", content: extractPrompt },
          ],
          0,
          true,
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

        const rewritePrompt = `You are an expert ATS resume writer specializing in creating keyword-optimized, achievement-focused resumes.

ABSOLUTE REQUIREMENT: Final resume MUST be 500-700 words (excluding contact info). This is NON-NEGOTIABLE.

CRITICAL RULES - DO NOT VIOLATE:
1. NEVER fabricate skills, experience, or achievements not in the original resume
2. NEVER add technologies, tools, or certifications the candidate doesn't have
3. ONLY use information explicitly stated in the original resume
4. If original resume lacks details, expand on EXISTING accomplishments, don't invent new ones
5. Reframe and optimize what EXISTS, never create what DOESN'T exist

STRUCTURE (follow this EXACT order):

1. PROFESSIONAL SUMMARY (60-80 words)
2. CORE COMPETENCIES (50-70 words)
3. PROFESSIONAL EXPERIENCE (280-350 words)
4. EDUCATION (40-60 words)
5. TECHNICAL SKILLS (50-80 words)
6. LANGUAGES (20-30 words) - MANDATORY
7. CERTIFICATIONS (30-50 words) - only if present in original resume

FORMATTING REQUIREMENTS:
- Section headers: ALL CAPS, no special characters
- Bullet points: Use • symbol
- Dates: MM/YYYY format or YYYY
- Clear line breaks between sections (use \\n\\n)
- No contact information in the resume body

OPTIMIZATION STRATEGY:
- Mirror job description language and keywords
- Replace generic terms with specific, powerful alternatives
- Transform responsibilities into achievements
- Add context and impact to existing accomplishments
- Ensure every bullet demonstrates value

WORD COUNT VERIFICATION:
- After writing, count words
- If under 500: expand existing achievements, add more detail to experience bullets
- If over 700: consolidate similar points, remove less impactful bullets
- FINAL RESUME MUST BE 500-700 WORDS

Return this exact JSON structure:
{
  "rewritten_resume": "PROFESSIONAL SUMMARY\\n[content]\\n\\nCORE COMPETENCIES\\n[content]\\n\\nPROFESSIONAL EXPERIENCE\\n[content]\\n\\nEDUCATION\\n[content]\\n\\nTECHNICAL SKILLS\\n[content]\\n\\nLANGUAGES\\n[content]\\n\\nCERTIFICATIONS\\n[content if applicable]",
  "word_count": 650
}

ORIGINAL RESUME:
${payload.resume}

JOB DESCRIPTION:
${payload.jobDescription}`

        const content = await callGroqChat(
          "llama-3.1-8b-instant",
          [
            {
              role: "system",
              content:
                "You are an expert ATS resume writer. You MUST produce resumes between 500-700 words. You NEVER fabricate experience or skills. You optimize truthfully. Return only valid JSON.",
            },
            { role: "user", content: rewritePrompt },
          ],
          0.3,
          true,
        )

        const parsed = parseJsonSafe(content)

        const rewritten = String(parsed.rewritten_resume || "")
        const wordCount = countWords(rewritten)

        // ✅ شرط صارم 500–700 كلمة
        if (wordCount < 500 || wordCount > 700) {
          throw new Error(
            `LENGTH_CONSTRAINT_VIOLATION: optimized resume has ${wordCount} words (required 500–700).`,
          )
        }

        return NextResponse.json({
          rewritten_resume: rewritten,
          word_count: typeof parsed.word_count === "number" ? parsed.word_count : wordCount,
          contact_info: {
            fullName: fullName,
            email: contactInfo.email || "",
            phone: contactInfo.phone || "",
            linkedin: contactInfo.linkedin || "",
            location: contactInfo.location || "",
          },
        })
      }

      // 3) FULL AUDIT متقدم – نسخة Groq من منطق Gemini
      case "fullAudit": {
        const jdWordCount = countWords(payload.jobDescription || "")
        const hasUsableJD = jdWordCount >= 40

        const systemPrompt = `
You are an elite Enterprise ATS Quality Control Auditor & Global Recruiter.

MISSION:
- Audit the resume.
- Produce an optimized ATS-safe version.
- Optionally evaluate Job Match if the job description is detailed enough.

HARD RULES:
- You NEVER fabricate experience, tools, companies, projects, or certifications.
- You ONLY rephrase, reorganize, and clarify what already exists in the original resume.
- FINAL optimized resume MUST be between 500 and 700 words (inclusive).
- No markdown, no decorative symbols, no tables, no pipes "|".
- Resume must be multi-line, with clear UPPERCASE section headings and vertical layout.
- ONE blank line between sections.
- Bullets must start with "- " (hyphen + space).
- Contact info simple and vertical, no inline "Name | Email | Phone".

JOB DESCRIPTION USAGE:
- If the JD is detailed (around 40+ words), you may compute job_match_analysis.
- DO NOT copy responsibilities or achievements from the JD into the resume text.
- JD is for evaluation only, not for inventing new content.
        `.trim()

        const userPrompt = `
You will receive:
1) A resume text to audit and optimize.
2) A job description for ATS match analysis.

Return ONLY valid JSON with this exact structure:

{
  "audit_findings": [
    {
      "issue": "string",
      "why_it_is_a_problem": "string",
      "ats_real_world_impact": "string",
      "correction_applied": "string"
    }
  ],
  "corrected_before_optimization": {
    "scores": {
      "ats_structure": 0,
      "keyword_match": 0,
      "experience_impact": 0,
      "formatting_readability": 0,
      "seniority_alignment": 0
    },
    "final_ats_score": 0,
    "ats_confidence_level": 0,
    "ats_rejection_risk": "Low | Medium | High"
  },
  "corrected_optimized_resume": {
    "plain_text": "FULL FINAL RESUME TEXT HERE",
    "sections": {
      "summary": "string",
      "experience": "string",
      "skills": "string",
      "education": "string",
      "certifications": "string"
    },
    "word_count": 600
  },
  "corrected_after_optimization": {
    "scores": {
      "ats_structure": 0,
      "keyword_match": 0,
      "experience_impact": 0,
      "formatting_readability": 0,
      "seniority_alignment": 0
    },
    "final_ats_score": 0,
    "ats_confidence_level": 0,
    "ats_rejection_risk": "Low | Medium | High"
  },
  "credibility_verdict": {
    "score_change_rationale": "string",
    "trust_level": "Low | Medium | High | Very High",
    "enterprise_readiness": "string"
  },
  "job_match_analysis": ${
    hasUsableJD
      ? `{
    "match_score": 0,
    "match_level": "Low | Medium | High | Excellent",
    "missing_keywords": ["string"],
    "recruiter_view": "string"
  }`
      : "null"
  }
}

CONSTRAINTS ON corrected_optimized_resume.plain_text:
- 500–700 words TOTAL.
- Multi-line, ATS-safe, NO pipes "|".
- Section headers in UPPERCASE (PROFESSIONAL SUMMARY, EXPERIENCE, SKILLS, EDUCATION, CERTIFICATIONS, LANGUAGES if present).
- ONE blank line between sections.
- Bullets start with "- " only.
- Do not collapse everything into one paragraph.

RESUME TO AUDIT:
"""
${payload.resume}
"""

JOB DESCRIPTION:
"""
${payload.jobDescription}
"""
        `.trim()

        const content = await callGroqChat(
          "llama-3.1-8b-instant",
          [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: userPrompt,
            },
          ],
          0.2,
          true,
        )

        let raw = content
        let cleaned = raw
          .replace(/```json\s*/gi, "")
          .replace(/```\s*/gi, "")
          .trim()

        let parsed: any
        try {
          parsed = JSON.parse(cleaned)
        } catch {
          const extracted = extractAndCleanJson(raw)
          parsed = JSON.parse(extracted)
        }

        const plain = String(parsed?.corrected_optimized_resume?.plain_text || "")
        const wordCount = countWords(plain)

        if (wordCount < 500 || wordCount > 700) {
          throw new Error(
            `LENGTH_CONSTRAINT_VIOLATION: optimized resume has ${wordCount} words (required 500–700).`,
          )
        }

        if (!parsed.corrected_optimized_resume) {
          parsed.corrected_optimized_resume = {}
        }
        parsed.corrected_optimized_resume.word_count = wordCount

        return NextResponse.json(parsed)
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
