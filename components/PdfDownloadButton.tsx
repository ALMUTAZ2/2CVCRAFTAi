"use client"

import { useState } from "react"
import { jsPDF } from "jspdf"

type ContactInfo = {
  fullName: string
  email: string
  phone: string
  linkedin: string
  location: string
}

interface PdfDownloadButtonProps {
  resumeText: string
  contactInfo: ContactInfo
  disabled?: boolean
}

export default function PdfDownloadButton({ resumeText, contactInfo, disabled }: PdfDownloadButtonProps) {
  const [isGenerating, setIsGenerating] = useState(false)

  const generatePdf = async () => {
    console.log("[v0] generatePdf called")
    console.log("[v0] resumeText length:", resumeText?.length)
    console.log("[v0] resumeText preview:", resumeText?.substring(0, 200))
    console.log("[v0] contactInfo:", contactInfo)

    if (!resumeText || !resumeText.trim()) {
      console.log("[v0] resumeText is empty, aborting")
      alert("No resume text to generate PDF")
      return
    }

    setIsGenerating(true)

    try {
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      })

      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const margin = 20
      const contentWidth = pageWidth - margin * 2
      const bottomMargin = 15
      let yPosition = margin

      const displayName = contactInfo?.fullName?.trim() || "Your Name"
      console.log("[v0] displayName:", displayName)

      doc.setFontSize(22)
      doc.setFont("helvetica", "bold")
      doc.setTextColor(0, 0, 0)
      doc.text(displayName, pageWidth / 2, yPosition, { align: "center" })
      yPosition += 8

      const contactParts: string[] = []
      if (contactInfo?.email) contactParts.push(contactInfo.email)
      if (contactInfo?.phone) contactParts.push(contactInfo.phone)
      if (contactInfo?.location) contactParts.push(contactInfo.location)

      console.log("[v0] contactParts:", contactParts)

      if (contactParts.length > 0) {
        doc.setFontSize(10)
        doc.setFont("helvetica", "normal")
        doc.setTextColor(80, 80, 80)
        doc.text(contactParts.join("  |  "), pageWidth / 2, yPosition, { align: "center" })
        yPosition += 5
      }

      if (contactInfo?.linkedin) {
        doc.setFontSize(10)
        doc.setFont("helvetica", "normal")
        doc.setTextColor(0, 102, 204)
        doc.text(contactInfo.linkedin, pageWidth / 2, yPosition, { align: "center" })
        yPosition += 5
      }

      yPosition += 3
      doc.setDrawColor(0, 0, 0)
      doc.setLineWidth(0.5)
      doc.line(margin, yPosition, pageWidth - margin, yPosition)
      yPosition += 8

      const lines = resumeText.split(/\r?\n/)
      console.log("[v0] Total lines to process:", lines.length)

      const checkPageBreak = (additionalSpace = 0) => {
        if (yPosition + additionalSpace > pageHeight - bottomMargin) {
          doc.addPage()
          yPosition = margin
          return true
        }
        return false
      }

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const trimmedLine = line.trim()

        if (!trimmedLine) {
          yPosition += 3
          continue
        }

        const isHeader =
          /^[A-Z\s]+:?$/.test(trimmedLine) ||
          /^(SUMMARY|EXPERIENCE|EDUCATION|SKILLS|CERTIFICATIONS|PROJECTS|LANGUAGES|PROFILE|OBJECTIVE|WORK HISTORY|PROFESSIONAL EXPERIENCE|TECHNICAL SKILLS|KEY SKILLS|ACHIEVEMENTS|AWARDS|REFERENCES|PROFESSIONAL SUMMARY|CORE COMPETENCIES|WORK EXPERIENCE)/i.test(
            trimmedLine,
          )

        const isBullet = trimmedLine.startsWith("•") || trimmedLine.startsWith("-") || trimmedLine.startsWith("*")
        const isJobTitle = /(\d{4}|present|current|–|—|-)/i.test(trimmedLine) && !isBullet && !isHeader

        if (isHeader) {
          checkPageBreak(15)

          yPosition += 5
          doc.setFontSize(12)
          doc.setFont("helvetica", "bold")
          doc.setTextColor(0, 0, 0)
          doc.text(trimmedLine.replace(/:$/, "").toUpperCase(), margin, yPosition)
          yPosition += 4

          doc.setDrawColor(100, 100, 100)
          doc.setLineWidth(0.3)
          doc.line(margin, yPosition, pageWidth - margin, yPosition)
          yPosition += 5
        } else if (isBullet) {
          doc.setFontSize(10)
          doc.setFont("helvetica", "normal")
          doc.setTextColor(0, 0, 0)

          const bulletText = trimmedLine.replace(/^[•\-*]\s*/, "")
          const wrappedLines = doc.splitTextToSize("• " + bulletText, contentWidth - 10)

          wrappedLines.forEach((wrappedLine: string, idx: number) => {
            checkPageBreak(5)
            doc.text(idx === 0 ? wrappedLine : "  " + wrappedLine, margin + 5, yPosition)
            yPosition += 4.5
          })
        } else if (isJobTitle) {
          checkPageBreak(8)

          doc.setFontSize(11)
          doc.setFont("helvetica", "bold")
          doc.setTextColor(50, 50, 50)

          const wrappedLines = doc.splitTextToSize(trimmedLine, contentWidth)
          wrappedLines.forEach((wrappedLine: string) => {
            checkPageBreak(5)
            doc.text(wrappedLine, margin, yPosition)
            yPosition += 5
          })
          yPosition += 1
        } else {
          doc.setFontSize(10)
          doc.setFont("helvetica", "normal")
          doc.setTextColor(0, 0, 0)

          const wrappedLines = doc.splitTextToSize(trimmedLine, contentWidth)
          wrappedLines.forEach((wrappedLine: string) => {
            checkPageBreak(5)
            doc.text(wrappedLine, margin, yPosition)
            yPosition += 4.5
          })
        }
      }

      const fileName = contactInfo?.fullName?.trim()
        ? `${contactInfo.fullName.trim().replace(/\s+/g, "_")}_Resume.pdf`
        : "optimized-resume.pdf"

      console.log("[v0] Saving PDF as:", fileName)
      console.log("[v0] Total pages created:", doc.getNumberOfPages())
      doc.save(fileName)
    } catch (error) {
      console.error("[v0] PDF generation error:", error)
      alert("Failed to generate PDF. Please try again.")
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <button
      onClick={generatePdf}
      disabled={disabled || isGenerating || !resumeText?.trim()}
      className={`px-4 py-2 rounded-md text-sm font-semibold text-white flex items-center gap-2 ${
        isGenerating || disabled || !resumeText?.trim()
          ? "bg-gray-400 cursor-not-allowed"
          : "bg-purple-600 hover:bg-purple-700"
      }`}
    >
      {isGenerating ? (
        <>
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          Generating PDF...
        </>
      ) : (
        <>
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          Download PDF
        </>
      )}
    </button>
  )
}
