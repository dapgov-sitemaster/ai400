export const sections=['Applicant information','Government employment','Education & training','Technical background','Supporting documents','Review & submit'];
export const competencies=['Python programming','Other programming languages','Data cleaning and manipulation','Data analysis and visualization','APIs and software libraries','Version control and collaboration','Software development workflows','AI and machine learning foundations'];
export const levels=['No experience','Basic','Working','Proficient','Advanced'];
export const functionsList=['Software development or engineering','Information technology or systems','Data science, engineering, or analytics','Database administration','Digital transformation or innovation','Automation or AI','Other'];
export const groups=[[
['name','Full legal name','text'],['email','Official email address','email'],['mobile','Mobile number','tel'],['location','Work location','text']],
[['agency','Agency or organization','text'],['acronym','Agency acronym','text'],['office','Office or unit','text'],['position','Current position','text'],['employment','Employment status','text'],['years','Years in government service','number'],['supervisor','Immediate supervisor','text'],['supervisorEmail','Supervisor official email','email']],
[['degree','Degree or program','text'],['field','Field of study','text'],['institution','Institution','text'],['year','Year completed','number']]];
export const words=(s:string)=>s.trim()?s.trim().split(/\s+/).length:0;
export function issues(d: Record<string, unknown>) {
  const out: { step: number; message: string }[] = [];
  const text = (key: string) => (typeof d[key] === "string" ? d[key].trim() : "");

  groups.forEach((group, step) => {
    group.forEach(([key, label]) => {
      if (!text(key)) out.push({ step, message: `${label} is required.` });
    });
  });

  for (const key of ["email", "supervisorEmail"]) {
    const email = text(key);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      out.push({
        step: key === "email" ? 0 : 1,
        message: `Enter a valid ${key === "email" ? "official" : "supervisor"} email address.`,
      });
    }
  }

  const selectedFunctions = Array.isArray(d.functions)
    ? d.functions.filter((item): item is string => typeof item === "string")
    : [];
  if (!selectedFunctions.length) {
    out.push({ step: 1, message: "Select at least one relevant function." });
  }
  if (selectedFunctions.includes("Other") && !text("otherFunction")) {
    out.push({ step: 1, message: "Please specify your other function." });
  }
  if (!text("attainment")) {
    out.push({
      step: 2,
      message: "Select your highest educational attainment.",
    });
  }

  for (const [key, max, step, label] of [
    ["duties", 150, 1, "Current duties and responsibilities"],
    ["project", 250, 3, "Most relevant technical project"],
  ] as const) {
    const answer = text(key);
    if (!answer || words(answer) > max) {
      out.push({ step, message: `${label} must contain 1–${max} words.` });
    }
  }

  for (let i = 0; i < competencies.length; i++) {
    const rating = d[`skill${i}`];
    if (typeof rating !== "string" || !levels.includes(rating)) {
      out.push({
        step: 3,
        message: `Rate ${competencies[i].toLowerCase()}.`,
      });
    }
  }
  if (!["attached", "follow"].includes(text("endorsement"))) {
    out.push({
      step: 4,
      message:
        "Choose attached or to follow for the agency nomination letter.",
    });
  }

  const years = text("years");
  if (years && (!Number.isFinite(Number(years)) || Number(years) < 0 || Number(years) > 80)) {
    out.push({
      step: 1,
      message: "Enter valid years in government service.",
    });
  }
  return out;
}

const allowedApplicationFields = new Set([
  ...groups.flatMap((group) => group.map(([key]) => key)),
  "cohort",
  "accommodation",
  "functions",
  "otherFunction",
  "duties",
  "attainment",
  "foundation0",
  "provider0",
  "completed0",
  "proof0",
  "foundation1",
  "provider1",
  "completed1",
  "proof1",
  "training0",
  "trainingProvider0",
  "trainingYear0",
  "trainingRelevance0",
  "training1",
  "trainingProvider1",
  "trainingYear1",
  "trainingRelevance1",
  "training2",
  "trainingProvider2",
  "trainingYear2",
  "trainingRelevance2",
  "tools",
  "portfolio",
  "project",
  "endorsement",
  ...Array.from({ length: competencies.length }, (_, index) => `skill${index}`),
]);

export function normalizeApplicationData(
  value: unknown,
): Record<string, unknown> | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return null;
  }

  const entries = Object.entries(value);
  if (
    entries.length > allowedApplicationFields.size ||
    entries.some(([key]) => !allowedApplicationFields.has(key))
  ) {
    return null;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, entry] of entries) {
    if (key === "functions") {
      if (
        !Array.isArray(entry) ||
        entry.length > functionsList.length ||
        entry.some(
          (item) =>
            typeof item !== "string" || !functionsList.includes(item),
        ) ||
        new Set(entry).size !== entry.length
      ) {
        return null;
      }
      normalized[key] = entry;
      continue;
    }

    if (
      typeof entry !== "string" ||
      entry.length > 6000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(entry)
    ) {
      return null;
    }
    normalized[key] = entry;
  }

  return normalized;
}
