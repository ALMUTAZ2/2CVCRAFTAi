"use client"

interface ResumePdfTemplateProps {
  resumeText: string
}

export default function ResumePdfTemplate({ resumeText }: ResumePdfTemplateProps) {
  console.log("[v0] ResumePdfTemplate received text length:", resumeText.length)

  // Parse the resume text into sections
  const lines = resumeText.split("\n").filter((line) => line.trim())

  const sections: { [key: string]: string[] } = {}
  let currentSection = "HEADER"
  const nameAndContact: string[] = []
  let contactLineCount = 0

  lines.forEach((line, index) => {
    const trimmedLine = line.trim()

    // First few lines are typically name and contact
    if (index < 5 && (index === 0 || /(@|phone|email|linkedin|github|http|www\.|\+\d|•|,)/i.test(trimmedLine))) {
      nameAndContact.push(line)
      contactLineCount++
      return
    }

    const isHeader =
      /^[A-Z\s]+:?$/.test(trimmedLine) ||
      /^(PROFESSIONAL SUMMARY|SUMMARY|EXPERIENCE|PROFESSIONAL EXPERIENCE|WORK HISTORY|EDUCATION|SKILLS|TECHNICAL SKILLS|KEY SKILLS|CERTIFICATIONS|PROJECTS|LANGUAGES|LANGUAGE|CONTACT|PROFILE|OBJECTIVE|ACHIEVEMENTS|AWARDS|REFERENCES)/i.test(
        trimmedLine,
      )

    if (isHeader) {
      currentSection = trimmedLine.replace(/:$/, "").toUpperCase()
      sections[currentSection] = []
      console.log("[v0] Found section:", currentSection)
    } else {
      if (!sections[currentSection]) {
        sections[currentSection] = []
      }
      sections[currentSection].push(line)
    }
  })

  console.log("[v0] All sections found:", Object.keys(sections))

  const page1Sections = [
    "PROFESSIONAL SUMMARY",
    "SUMMARY",
    "EXPERIENCE",
    "PROFESSIONAL EXPERIENCE",
    "WORK HISTORY",
    "EDUCATION",
    "CERTIFICATIONS",
  ]

  const page2Sections = [
    "SKILLS",
    "TECHNICAL SKILLS",
    "KEY SKILLS",
    "LANGUAGES",
    "LANGUAGE",
    "PROJECTS",
    "ACHIEVEMENTS",
    "AWARDS",
  ]

  const renderSection = (sectionName: string, content: string[]) => {
    if (!content || content.length === 0) return null

    console.log("[v0] Rendering section:", sectionName, "with", content.length, "lines")

    return (
      <div key={sectionName} className="mb-6">
        <h2
          className="text-base font-bold text-black border-b-2 border-gray-800 pb-1 mb-3 uppercase tracking-wide"
          style={{ fontSize: "13pt", fontWeight: "bold" }}
        >
          {sectionName}
        </h2>
        <div className="space-y-1">
          {content.map((line, idx) => {
            const isBullet = line.trim().startsWith("•") || line.trim().startsWith("-") || line.trim().startsWith("*")

            if (isBullet) {
              return (
                <p key={idx} className="pl-4 text-black leading-relaxed" style={{ fontSize: "11pt" }}>
                  {line}
                </p>
              )
            }

            return (
              <p key={idx} className="text-black leading-relaxed" style={{ fontSize: "11pt" }}>
                {line}
              </p>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div id="resume-pdf-content" className="bg-white">
      <div
        className="w-[210mm] min-h-[297mm] mx-auto bg-white text-black p-[20mm] font-sans page-break-after"
        style={{
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: "11pt",
          lineHeight: "1.5",
          pageBreakAfter: "always",
        }}
      >
        {/* Header - Name and Contact */}
        <div className="mb-6 border-b-2 border-black pb-4">
          {nameAndContact.map((line, index) => {
            if (index === 0) {
              return (
                <h1
                  key={index}
                  className="text-3xl font-bold text-black mb-2"
                  style={{ fontSize: "20pt", fontWeight: "bold" }}
                >
                  {line}
                </h1>
              )
            }

            return (
              <p key={index} className="text-gray-700 text-sm" style={{ fontSize: "10pt" }}>
                {line}
              </p>
            )
          })}
        </div>

        {/* Page 1 Sections */}
        <div className="space-y-4">
          {Object.keys(sections).map((sectionName) => {
            if (page1Sections.some((p1) => sectionName.includes(p1))) {
              return renderSection(sectionName, sections[sectionName])
            }
            return null
          })}
        </div>
      </div>

      {/* Page 2 */}
      <div
        className="w-[210mm] min-h-[297mm] mx-auto bg-white text-black p-[20mm] font-sans"
        style={{
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: "11pt",
          lineHeight: "1.5",
        }}
      >
        {/* Repeat header on page 2 for context */}
        <div className="mb-6 border-b border-gray-400 pb-2">
          <h1 className="text-xl font-bold text-black" style={{ fontSize: "16pt", fontWeight: "bold" }}>
            {nameAndContact[0] || ""}
          </h1>
        </div>

        {/* Page 2 Sections */}
        <div className="space-y-4">
          {Object.keys(sections).map((sectionName) => {
            if (page2Sections.some((p2) => sectionName.includes(p2))) {
              return renderSection(sectionName, sections[sectionName])
            }
            return null
          })}

          {/* Render any remaining sections not in page1 or page2 */}
          {Object.keys(sections).map((sectionName) => {
            const isInPage1 = page1Sections.some((p1) => sectionName.includes(p1))
            const isInPage2 = page2Sections.some((p2) => sectionName.includes(p2))

            if (!isInPage1 && !isInPage2 && sectionName !== "HEADER") {
              return renderSection(sectionName, sections[sectionName])
            }
            return null
          })}
        </div>
      </div>
    </div>
  )
}
