export type MapItem = {
  id: string;
  kind: "pantry" | "event";
  name: string;
  address: string;
  zip: string;
  lat: number;
  lon: number;
  when: string;
  starts_at: string;
  tags: string[];
  languages: string[];
  requirements: string;
  phone: string;
  pantry_id: string;
  program_count: number;
  access_tags: string[];
};

export type ProgramField = {
  key: string;
  label: Record<string, string>;
  type: "text" | "tel" | "select" | "checkbox" | "textarea";
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
  requirements: string;
  processing_days: number;
  fields: ProgramField[];
  external_url: string;
};

export type Application = {
  application_id: string;
  program_id: string;
  status: string;
  created_at: string;
};

export type Bounds = { north: number; south: number; east: number; west: number };
