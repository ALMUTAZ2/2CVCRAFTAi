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
  // First, handle newlines within JSON string values
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

function parseJsonSafe(content: string): Record<string, unknown> {
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

async function callGroqChat(
  model: string,
  messages: { role: string; content: string }[],
  temperature = 0.2
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
      return NextResponse.json(
        { error: "resume and jobDescription are required" },
        { status: 400 }
      )
    }

    switch (action) {
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
          0
        )

        const parsed = parseJsonSafe(content)
        return NextResponse.json(parsed)
      }

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
              content:
                "You extract contact info from resumes. The name is ALWAYS at the top. Return only valid JSON.",
            },
            { role: "user", content: extractPrompt },
          ],
          0
        )

        const contactInfo = parseJsonSafe(contactContent) as any

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
   - Opening line: "[X] years of experience in [field]"
   - 2-3 core competencies from job description that match candidate's experience
   - 1-2 key achievements or unique value propositions
   - Must include 4-6 keywords from job description naturally

2. CORE COMPETENCIES (50-70 words)
   - 8-12 key skills in 2-3 category groups
   - Only skills from original resume
   - Format: Category • Skill 1 • Skill 2 • Skill 3

3. PROFESSIONAL EXPERIENCE (280-350 words)
   - List in reverse chronological order
   - For each role: Job Title | Company | Dates
   - 4-6 bullet points per role focusing on achievements
   - Start bullets with strong action verbs (Led, Developed, Implemented, Achieved)
   - Quantify results with numbers, percentages, or scale where possible
   - Align achievements with job description requirements

4. EDUCATION (40-60 words)
   - Degree | Institution | Year
   - Relevant coursework or honors only if space permits
   - Keep concise

5. TECHNICAL SKILLS (50-80 words)
   - Organize by category (Programming, Tools, Systems, etc.)
   - Only list technologies actually mentioned in original resume
   - Format: Category: skill1, skill2, skill3

6. LANGUAGES (20-30 words) - MANDATORY
   - List each language with proficiency level
   - Format: • Language Name - Proficiency Level
   - Levels: Native / Fluent / Advanced / Intermediate / Basic
   - If not in original, infer conservatively from context (e.g., Arabic if Saudi, English if international work)

7. CERTIFICATIONS (30-50 words)
   - Only include if in original resume
   - Format: Certification Name | Issuing Body | Year

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
          0.3
        )

        const parsed = parseJsonSafe(content) as any

        // ✅ فحص صارم لطول السيرة المحسنة 500–700 كلمة
        let wordCount = 0
        if (typeof parsed.word_count === "number") {
          wordCount = parsed.word_count
        } else if (typeof parsed.rewritten_resume === "string") {
          wordCount = parsed.rewritten_resume
            .trim()
            .split(/\s+/)
            .filter(Boolean).length
          parsed.word_count = wordCount
        }

        if (wordCount < 500 || wordCount > 700) {
          throw new Error(
            `LENGTH_CONSTRAINT_VIOLATION: optimized resume has ${wordCount} words (required 500–700).`
          )
        }

        return NextResponse.json({
          rewritten_resume: parsed.rewritten_resume || "",
          word_count: wordCount,
          contact_info: {
            fullName: fullName,
            email: contactInfo.email || "",
            phone: contactInfo.phone || "",
            linkedin: contactInfo.linkedin || "",
            location: contactInfo.location || "",
          },
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
