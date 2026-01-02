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
      max_tokens: 2000,
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
      // ===================== ATS ANALYZE =====================
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
          "llama-3.3-70b-versatile",
          [
            { role: "system", content: "You are an ATS. Return only valid JSON, no explanation." },
            { role: "user", content: prompt },
          ],
          0,
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

        const contactContent = await callGroqChat(
          "llama-3.3-70b-versatile",
          [
            {
              role: "system",
              content:
                "You extract contact info from resumes. The name is ALWAYS at the top. Return only valid JSON.",
            },
            { role: "user", content: extractPrompt },
          ],
          0,
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

        // 2) برومبت إعادة الصياغة مع كل الشروط الصارمة
        const rewritePrompt = `You are an expert ATS resume writer specializing in creating keyword-optimized, achievement-focused resumes.

ABSOLUTE REQUIREMENT:
The FINAL rewritten resume MUST be between 500 and 700 words (excluding contact info).
This is NON-NEGOTIABLE. Do NOT output fewer than 500 words, and do NOT exceed 700 words.

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

1. PROFESSIONAL SUMMARY (60–80 words)
Opening line: "[X] years of experience in [field]"
2–3 core competencies from job description that match candidate's experience
1–2 key achievements or unique value propositions
Must include 4–6 relevant keywords from the job description naturally

2. CORE COMPETENCIES (50–70 words)
8–12 key skills in 2–3 category groups
Only skills from the original resume
Format example:
CORE COMPETENCIES
• Power Systems: load flow, protection, EV integration
• Project Management: planning, stakeholder coordination
• Tools: CAD, analytics, reporting

3. PROFESSIONAL EXPERIENCE (280–350 words)
List in reverse chronological order.
For each role, first line:
Job Title — Company — Dates
Followed by 4–6 bullet points per role, each starting with "• ".
Start bullets with strong action verbs (Led, Developed, Implemented, Achieved, Optimized).
Quantify results with numbers, percentages, or scale where possible, BUT only if implied or stated in the original resume.
NO duplicate roles: if the same job repeats, merge logically into one continuous role with correct dates.

4. EDUCATION (40–60 words)
Degree, Institution, Country/City, Graduation Year.
Include relevant honors ONLY if already present in original resume.

5. TECHNICAL SKILLS (50–80 words)
Organize by category (Programming, Tools, Systems, Standards, etc.).
Only list technologies that appear in the original resume.
Use concise format per line with the bullet: • Category: skill1, skill2, skill3

6. LANGUAGES (20–30 words) — MANDATORY
Each language with proficiency level:
• Arabic — Native
• English — Fluent
Only infer languages that are clearly implied (e.g., Saudi engineer → Arabic, English for international work).

7. CERTIFICATIONS (30–50 words)
Only include REAL certifications explicitly mentioned in the resume (e.g., PMP®, PE, ISO, vendor certifications).
Do NOT treat short trainings or webinars as certifications.
Format:
• Certification Name — Issuing Body — Year (if available)

OPTIMIZATION STRATEGY:
Mirror important phrases from the job description where they match the candidate's true experience.
Replace generic wording with specific, powerful alternatives (while staying truthful).
Turn responsibilities into achievement-driven bullets.
Every bullet must show clear impact, scope, or ownership.

WORD COUNT VERIFICATION (MUST DO BEFORE RETURNING):
After writing the full resume (plain_text), count the words.
If under 500: expand existing bullets and descriptions using only existing facts.
If over 700: compress wording and remove redundant phrases, but keep all real experience.
FINAL OUTPUT MUST BE between 500 and 700 words.

FINAL JSON RESPONSE FORMAT (MANDATORY):
Return ONLY this JSON object, no markdown and no extra commentary:

{
  "rewritten_resume": "PROFESSIONAL SUMMARY\\n[content]\\n\\nCORE COMPETENCIES\\n[content]\\n\\nPROFESSIONAL EXPERIENCE\\n[content]\\n\\nEDUCATION\\n[content]\\n\\nTECHNICAL SKILLS\\n[content]\\n\\nLANGUAGES\\n[content]\\n\\nCERTIFICATIONS\\n[content if applicable]",
  "word_count": 650
}

"rewritten_resume" must exactly follow the formatting rules above.

ORIGINAL RESUME:
${payload.resume}

JOB DESCRIPTION:
${payload.jobDescription}`

        const MAX_ATTEMPTS = 3
        const MIN_FALLBACK_WORDS = 350 // أقل حد نقبله بعد 3 محاولات
        let lastRewritten = ""
        let lastWordCount = 0

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          const content = await callGroqChat(
            "llama-3.3-70b-versatile",
            [
              {
                role: "system",
                content:
                  "You are an expert ATS resume writer. You MUST produce resumes between 500-700 words, never fabricate experience or skills, and strictly follow the formatting rules. Return only valid JSON.",
              },
              { role: "user", content: rewritePrompt },
            ],
            0.3,
          )

          const parsed = parseJsonSafe(content)

          const rewritten = (parsed.rewritten_resume as string) || ""
          lastRewritten = rewritten

          // ✅ نحسب عدد الكلمات بأنفسنا ونتجاهل word_count من الموديل
          const wordCount = countWords(rewritten)
          lastWordCount = wordCount

          console.log(
            `REWRITE ATTEMPT ${attempt}/${MAX_ATTEMPTS} - computed wordCount = ${wordCount}`,
          )

          // تحقق من الطول 500–700 كلمة
          if (wordCount >= 300 && wordCount <= 700) {
            return NextResponse.json({
              rewritten_resume: rewritten,
              word_count: wordCount,
              contact_info: {
                fullName,
                email: (contactInfo.email as string) || "",
                phone: (contactInfo.phone as string) || "",
                linkedin: (contactInfo.linkedin as string) || "",
                location: (contactInfo.location as string) || "",
              },
            })
          }

          console.error(
            `LENGTH_CONSTRAINT_VIOLATION (attempt ${attempt}/${MAX_ATTEMPTS}): optimized resume has ${wordCount} words (required 500–700).`,
          )
        }

        // لو ٣ محاولات وما ضبط، بس الكلام فوق حد أدنى (٣٠٠ كلمة مثلاً)
        if (lastWordCount >= MIN_FALLBACK_WORDS) {
          return NextResponse.json({
            rewritten_resume: lastRewritten,
            word_count: lastWordCount,
            warning: `TARGET_LENGTH_NOT_REACHED_AFTER_${MAX_ATTEMPTS}_ATTEMPTS`,
            contact_info: {
              fullName,
              email: (contactInfo.email as string) || "",
              phone: (contactInfo.phone as string) || "",
              linkedin: (contactInfo.linkedin as string) || "",
              location: (contactInfo.location as string) || "",
            },
          })
        }

        // لو حتى بعد ٣ محاولات أقل من ٣٠٠ كلمة → نعتبره فشل حقيقي
        return NextResponse.json(
          {
            error: `LENGTH_CONSTRAINT_VIOLATION_AFTER_${MAX_ATTEMPTS}_ATTEMPTS`,
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
