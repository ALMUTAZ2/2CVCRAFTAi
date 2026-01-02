"use client"
import type { Resume } from "../types/resume"

interface Props {
  data: Resume
}

export default function ResumeTemplateModern({ data }: Props) {
  return (
    <div className="w-[900px] mx-auto bg-white text-gray-900 p-8 leading-relaxed shadow-md">
      {/* HEADER */}
      <div className="border-b pb-3 mb-4">
        <h1 className="text-3xl font-bold">{data.header.fullName}</h1>
        {data.header.title && <p className="text-lg text-gray-700">{data.header.title}</p>}

        <div className="text-sm text-gray-600 mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {data.header.email && <span>{data.header.email}</span>}
          {data.header.phone && <span>{data.header.phone}</span>}
          {data.header.location && <span>{data.header.location}</span>}
          {data.header?.links?.map((link, i) => (
            <a key={i} href={link.url} className="underline">
              {link.label}
            </a>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[2fr_1fr] gap-6">
        {/* LEFT — MAIN CONTENT */}
        <div>
          {/* SUMMARY */}
          {data.summary && (
            <section className="mb-5">
              <h2 className="font-bold text-lg border-b pb-1 mb-2">Professional Summary</h2>
              <p>{data.summary}</p>
            </section>
          )}

          {/* EXPERIENCE */}
          <section className="mb-5">
            <h2 className="font-bold text-lg border-b pb-1 mb-2">Experience</h2>

            {data.experiences?.map((exp, i) => (
              <div key={i} className="mb-3">
                <p className="font-semibold">
                  {exp.title} — {exp.company}
                </p>
                <p className="text-sm text-gray-600">
                  {exp.startDate} — {exp.endDate}
                </p>

                <ul className="list-disc ml-5 mt-1 text-sm">
                  {exp.bullets?.map((b, j) => (
                    <li key={j}>{b}</li>
                  ))}
                </ul>
              </div>
            ))}
          </section>

          {/* PROJECTS */}
          {data.projects && data.projects.length > 0 && (
            <section className="mb-5">
              <h2 className="font-bold text-lg border-b pb-1 mb-2">Projects</h2>

              {data.projects.map((p, i) => (
                <div key={i} className="mb-3">
                  <p className="font-semibold">{p.name}</p>
                  <p className="text-sm">{p.description}</p>

                  {p.bullets && p.bullets.length > 0 && (
                    <ul className="list-disc ml-5 mt-1 text-sm">
                      {p.bullets.map((b, j) => (
                        <li key={j}>{b}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </section>
          )}
        </div>

        {/* RIGHT — SIDEBAR */}
        <div>
          {/* SKILLS */}
          {data.skills && data.skills.length > 0 && (
            <section className="mb-5">
              <h2 className="font-bold text-lg border-b pb-1 mb-2">Skills</h2>
              <ul className="list-disc ml-5 text-sm">
                {data.skills.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </section>
          )}

          {/* EDUCATION */}
          {data.education && data.education.length > 0 && (
            <section className="mb-5">
              <h2 className="font-bold text-lg border-b pb-1 mb-2">Education</h2>

              {data.education.map((e, i) => (
                <div key={i} className="mb-2 text-sm">
                  <p className="font-semibold">{e.degree}</p>
                  <p>{e.school}</p>
                  {e.graduationDate && <p className="text-gray-600">{e.graduationDate}</p>}
                </div>
              ))}
            </section>
          )}

          {/* CERTIFICATIONS */}
          {data.certifications && data.certifications.length > 0 && (
            <section className="mb-5">
              <h2 className="font-bold text-lg border-b pb-1 mb-2">Certifications</h2>

              <ul className="list-disc ml-5 text-sm">
                {data.certifications.map((c, i) => (
                  <li key={i}>{c.name}</li>
                ))}
              </ul>
            </section>
          )}

          {/* LANGUAGES */}
          {data.languages && data.languages.length > 0 && (
            <section className="mb-5">
              <h2 className="font-bold text-lg border-b pb-1 mb-2">Languages</h2>
              <ul className="list-disc ml-5 text-sm">
                {data.languages.map((l, i) => (
                  <li key={i}>
                    {l.name} — {l.level}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* EXTRAS */}
          {data.extras && data.extras.length > 0 && (
            <section className="mb-5">
              {data.extras.map((extra, i) => (
                <div key={i} className="mb-3">
                  <h2 className="font-bold text-lg border-b pb-1 mb-2">{extra.label}</h2>
                  <ul className="list-disc ml-5 text-sm">
                    {extra.items.map((item, j) => (
                      <li key={j}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
