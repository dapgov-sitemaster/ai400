export type CsvApplication = {
  data: Record<string, unknown>;
  enrollmentStatus: "not_enrolled" | "enrolled";
  reference: string | null;
  submitted: string | Date;
  uploads?: { name: string }[];
};

const FIELD_LABELS: Record<string, string> = {
  name: "Full legal name",
  email: "Official email address",
  mobile: "Mobile number",
  location: "Work location",
  cohort: "Batch or cohort",
  accommodation: "Accessibility or accommodation requirements",
  agency: "Agency or organization",
  acronym: "Agency acronym",
  office: "Office or unit",
  position: "Current position",
  employment: "Employment status",
  years: "Years in government service",
  supervisor: "Immediate supervisor",
  supervisorEmail: "Supervisor official email",
  functions: "Relevant functions",
  otherFunction: "Other function",
  duties: "Current duties and responsibilities",
  degree: "Degree or program",
  field: "Field of study",
  institution: "Institution",
  year: "Year completed",
  attainment: "Highest educational attainment",
  foundation0: "Foundation training 1",
  provider0: "Foundation training 1 provider",
  completed0: "Foundation training 1 completion",
  proof0: "Foundation training 1 proof",
  foundation1: "Foundation training 2",
  provider1: "Foundation training 2 provider",
  completed1: "Foundation training 2 completion",
  proof1: "Foundation training 2 proof",
  training0: "Additional training 1",
  trainingProvider0: "Additional training 1 provider",
  trainingYear0: "Additional training 1 year",
  trainingRelevance0: "Additional training 1 relevance",
  training1: "Additional training 2",
  trainingProvider1: "Additional training 2 provider",
  trainingYear1: "Additional training 2 year",
  trainingRelevance1: "Additional training 2 relevance",
  training2: "Additional training 3",
  trainingProvider2: "Additional training 3 provider",
  trainingYear2: "Additional training 3 year",
  trainingRelevance2: "Additional training 3 relevance",
  tools: "Languages and tools",
  portfolio: "Portfolio or repository",
  project: "Most relevant technical project",
  endorsement: "Agency nomination / endorsement letter",
};

export function formatApplicationFieldLabel(key: string): string {
  const skill = /^skill([0-7])$/.exec(key);
  if (skill) {
    const competencies = [
      "Python programming",
      "Other programming languages",
      "Data cleaning and manipulation",
      "Data analysis and visualization",
      "APIs and software libraries",
      "Version control and collaboration",
      "Software development workflows",
      "AI and machine learning foundations",
    ];
    return competencies[Number(skill[1])];
  }
  return (
    FIELD_LABELS[key] ??
    key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (letter) =>
      letter.toUpperCase(),
    )
  );
}

function csvCell(value: unknown): string {
  let text: string;
  if (Array.isArray(value)) {
    text = value.map((item) => String(item ?? "")).join(", ");
  } else if (value === null || value === undefined) {
    text = "";
  } else if (typeof value === "object") {
    text = JSON.stringify(value);
  } else {
    text = String(value);
  }

  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function createApplicationsCsv(applications: CsvApplication[]): string {
  const fields = Array.from(
    new Set(applications.flatMap((application) => Object.keys(application.data))),
  );
  const headers = [
    "Reference",
    "Submitted (Philippine time)",
    "Enrollment status",
    "Supporting document filenames",
    ...fields.map(formatApplicationFieldLabel),
  ];
  const rows = applications.map((application) => [
    application.reference ?? "",
    (application.submitted instanceof Date
      ? application.submitted
      : new Date(application.submitted)
    ).toLocaleString("en-PH", { timeZone: "Asia/Manila" }),
    application.enrollmentStatus === "enrolled" ? "Enrolled" : "Not enrolled",
    application.uploads?.map((upload) => upload.name).join("; ") ?? "",
    ...fields.map((field) => application.data[field]),
  ]);

  return `\uFEFF${[headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n")}\r\n`;
}
