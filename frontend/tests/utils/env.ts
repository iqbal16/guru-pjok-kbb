export type RoleName = "admin" | "kepsek" | "pengawas" | "guru" | "guruOther";

export type RoleCredentials = {
  role: RoleName;
  email: string;
  password: string;
};

const ENV_KEYS: Record<RoleName, [string, string]> = {
  admin: ["E2E_ADMIN_EMAIL", "E2E_ADMIN_PASSWORD"],
  kepsek: ["E2E_KEPSEK_EMAIL", "E2E_KEPSEK_PASSWORD"],
  pengawas: ["E2E_PENGAWAS_EMAIL", "E2E_PENGAWAS_PASSWORD"],
  guru: ["E2E_GURU_EMAIL", "E2E_GURU_PASSWORD"],
  guruOther: ["E2E_GURU_OTHER_EMAIL", "E2E_GURU_OTHER_PASSWORD"],
};

export function credentialsFor(role: RoleName): RoleCredentials | null {
  const [emailKey, passwordKey] = ENV_KEYS[role];
  const email = process.env[emailKey];
  const password = process.env[passwordKey];
  if (!email || !password) return null;
  return { role, email, password };
}

export function requiredCredentials(role: RoleName): RoleCredentials {
  const credentials = credentialsFor(role);
  if (!credentials) {
    throw new Error(`Credential ${role} belum tersedia di .env.test`);
  }
  return credentials;
}

export function configuredRoles() {
  return (Object.keys(ENV_KEYS) as RoleName[])
    .map((role) => credentialsFor(role))
    .filter(Boolean) as RoleCredentials[];
}
