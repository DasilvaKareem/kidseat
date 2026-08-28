import { pgQuery } from "./postgres";

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
  fields: ProgramField[];
  external_url: string;
};

export type ProgramWithFields = Program;

// `fields` is jsonb with a CHECK that it is an array, so it arrives parsed and
// already the right shape -- no JSON.parse, and no try/catch around one.
// pantry_id is NULL for a standalone program; the callers all expect ''.
const SELECT = `program_id, name, provider, kind, summary,
                COALESCE(pantry_id, '') AS pantry_id, zip_scope, languages,
                requirements, processing_days, fields, external_url`;

const STAMPS = `to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS created_at,
                to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS updated_at`;

const APPLICATION_COLS = `application_id, phone_hash, program_id, status, answers,
                          note, locale, ${STAMPS}`;

// Postgres rejects a malformed uuid with an error rather than no rows, so a
// junk id from a client would 500 instead of 404 without this.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listPrograms(opts: {
  zip?: string;
  pantryId?: string;
}): Promise<ProgramWithFields[]> {
  return pgQuery<Program>(
    `SELECT ${SELECT} FROM programs
     WHERE active
       AND ($1 = '' OR pantry_id = $1)
       AND (cardinality(zip_scope) = 0 OR $2 = '' OR $2 = ANY (zip_scope))
     ORDER BY kind, name
     LIMIT 100`,
    [opts.pantryId ?? "", opts.zip ?? ""],
  );
}

export async function getProgram(programId: string): Promise<ProgramWithFields | null> {
  const rows = await pgQuery<Program>(
    `SELECT ${SELECT} FROM programs WHERE active AND program_id = $1 LIMIT 1`,
    [programId],
  );
  return rows[0] ?? null;
}

export type Application = {
  application_id: string;
  phone_hash: string;
  program_id: string;
  status: string;
  answers: Record<string, string>;
  note: string;
  locale: string;
  created_at: string;
  updated_at: string;
};

export async function listApplications(phoneHash: string): Promise<Application[]> {
  return pgQuery<Application>(
    `SELECT ${APPLICATION_COLS} FROM applications
     WHERE phone_hash = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [phoneHash],
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
  // The id and both timestamps are the database's to assign. The foreign key
  // on program_id means an application can never point at a program that is
  // not there -- previously nothing enforced that.
  const rows = await pgQuery<Application>(
    `INSERT INTO applications (phone_hash, program_id, answers, locale)
     VALUES ($1, $2, $3::jsonb, $4)
     RETURNING ${APPLICATION_COLS}`,
    [input.phoneHash, input.programId, JSON.stringify(input.answers), input.locale],
  );
  return rows[0];
}

export async function withdrawApplication(
  phoneHash: string,
  applicationId: string,
): Promise<boolean> {
  if (!UUID.test(applicationId)) return false;
  // One statement, and still scoped by phone_hash as well as id so nobody can
  // withdraw someone else's. Read-then-write was only ever needed because
  // ClickHouse had no UPDATE; it also raced with itself.
  const rows = await pgQuery<{ application_id: string }>(
    `UPDATE applications
     SET status = 'withdrawn', updated_at = now()
     WHERE application_id = $1::uuid AND phone_hash = $2 AND status <> 'withdrawn'
     RETURNING application_id`,
    [applicationId, phoneHash],
  );
  return rows.length > 0;
}
