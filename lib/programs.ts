import crypto from "node:crypto";
import { query, insert, chTime } from "./clickhouse";

export type FieldType = "text" | "tel" | "select" | "checkbox" | "textarea";

export type ProgramField = {
  key: string;
  label: Record<string, string>;
  type: FieldType;
  options?: string[];
  required?: boolean;
  help?: Record<string, string>;
};

export type Program = {
  program_id: string;
  name: string;
  provider: string;
  kind: string;
  summary: string;
  pantry_id: string;
  zip_scope: string[];
  languages: string[];
  requirements: string;
  processing_days: number;
  fields: string;
  external_url: string;
};

export type ProgramWithFields = Omit<Program, "fields"> & { fields: ProgramField[] };

function parseFields(raw: string): ProgramField[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? (parsed as ProgramField[]) : [];
  } catch {
    // A malformed field definition must not take down the page — the program
    // still renders, just with no form.
    return [];
  }
}

const SELECT = `program_id, name, provider, kind, summary, pantry_id, zip_scope,
                languages, requirements, processing_days, fields, external_url`;

export async function listPrograms(opts: {
  zip?: string;
  pantryId?: string;
}): Promise<ProgramWithFields[]> {
  const rows = await query<Program>(
    `SELECT ${SELECT} FROM programs FINAL
     WHERE active = 1
       AND ({pantry:String} = '' OR pantry_id = {pantry:String})
       AND (empty(zip_scope) OR {zip:String} = '' OR has(zip_scope, {zip:String}))
     ORDER BY kind, name
     LIMIT 100`,
    { pantry: opts.pantryId ?? "", zip: opts.zip ?? "" },
  );
  return rows.map((r) => ({ ...r, fields: parseFields(r.fields) }));
}

export async function getProgram(programId: string): Promise<ProgramWithFields | null> {
  const rows = await query<Program>(
    `SELECT ${SELECT} FROM programs FINAL
     WHERE active = 1 AND program_id = {id:String} LIMIT 1`,
    { id: programId },
  );
  const row = rows[0];
  return row ? { ...row, fields: parseFields(row.fields) } : null;
}

export type Application = {
  application_id: string;
  phone_hash: string;
  program_id: string;
  status: string;
  answers: string;
  note: string;
  locale: string;
  created_at: string;
  updated_at: string;
};

export async function listApplications(phoneHash: string): Promise<Application[]> {
  return query<Application>(
    `SELECT application_id, phone_hash, program_id, status, answers, note, locale,
            toString(created_at) AS created_at, toString(updated_at) AS updated_at
     FROM applications FINAL
     WHERE phone_hash = {hash:String}
     ORDER BY created_at DESC
     LIMIT 100`,
    { hash: phoneHash },
  );
}

/**
 * Validates answers against the program's own field definitions rather than a
 * hardcoded shape, and drops anything the program did not ask for — a client
 * cannot smuggle extra keys into a stored record.
 */
export function validateAnswers(
  program: ProgramWithFields,
  answers: Record<string, unknown>,
): { ok: true; clean: Record<string, string> } | { ok: false; missing: string[] } {
  const clean: Record<string, string> = {};
  const missing: string[] = [];

  for (const field of program.fields) {
    const raw = answers[field.key];
    const value =
      field.type === "checkbox"
        ? raw === true || raw === "true"
          ? "yes"
          : ""
        : typeof raw === "string"
          ? raw.trim().slice(0, 2000)
          : "";

    if (field.type === "select" && value && !(field.options ?? []).includes(value)) {
      missing.push(field.key);
      continue;
    }
    if (field.required && !value) {
      missing.push(field.key);
      continue;
    }
    if (value) clean[field.key] = value;
  }

  return missing.length > 0 ? { ok: false, missing } : { ok: true, clean };
}

export async function submitApplication(input: {
  phoneHash: string;
  programId: string;
  answers: Record<string, string>;
  locale: string;
}): Promise<Application> {
  const now = chTime();
  const row: Application = {
    application_id: crypto.randomUUID(),
    phone_hash: input.phoneHash,
    program_id: input.programId,
    status: "submitted",
    answers: JSON.stringify(input.answers),
    note: "",
    locale: input.locale,
    created_at: now,
    updated_at: now,
  };
  await insert("applications", [row]);
  return row;
}

export async function withdrawApplication(
  phoneHash: string,
  applicationId: string,
): Promise<boolean> {
  const rows = await query<Application>(
    `SELECT application_id, phone_hash, program_id, status, answers, note, locale,
            toString(created_at) AS created_at, toString(updated_at) AS updated_at
     FROM applications FINAL
     WHERE application_id = {id:String} AND phone_hash = {hash:String} LIMIT 1`,
    { id: applicationId, hash: phoneHash },
  );
  const existing = rows[0];
  // Scoped by phone_hash as well as id, so one person cannot withdraw another's.
  if (!existing) return false;
  await insert("applications", [
    { ...existing, status: "withdrawn", updated_at: chTime() },
  ]);
  return true;
}
