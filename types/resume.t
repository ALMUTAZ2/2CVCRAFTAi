export type Resume = {
  header: {
    fullName: string
    title?: string
    email?: string
    phone?: string
    location?: string
    links?: { label: string; url: string }[]
  }
  summary?: string
  experiences: {
    title: string
    company: string
    location?: string
    startDate?: string
    endDate?: string | "Present"
    bullets: string[]
  }[]
  education: {
    degree: string
    school: string
    location?: string
    graduationDate?: string
    details?: string[]
  }[]
  skills: string[]
  certifications?: {
    name: string
    issuer?: string
    year?: string
  }[]
  projects?: {
    name: string
    description: string
    bullets?: string[]
  }[]
  languages?: {
    name: string
    level: string
  }[]
  extras?: {
    label: string
    items: string[]
  }[]
}
